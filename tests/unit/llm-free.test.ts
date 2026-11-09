import { afterEach, describe, expect, it } from "vitest";
import { buildLlmProvider, MockLlmProvider } from "@/adapters/llm";
import { freeConfig, OpenAiCompatibleProvider, redact, ResilientLlm, setLlmFetcher } from "@/adapters/llm/free";

type Call = { url: string; body: Record<string, unknown>; auth: string | undefined };
function fakeFetch(answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  setLlmFetcher(async (url, init) => {
    const call = { url, body: JSON.parse(String(init.body)) as Record<string, unknown>, auth: (init.headers as Record<string, string>).authorization };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error("network down");
    return next(call);
  });
  return calls;
}
const ok = (content: string, tool_calls?: unknown[]) => () => Response.json({ choices: [{ message: { content, tool_calls } }] });
const status = (n: number) => () => new Response("{}", { status: n });
afterEach(() => setLlmFetcher((url, init) => fetch(url, init)));

describe("privacy", () => {
  it("strips emails, phones, SSNs and account numbers", () => {
    expect(redact("Email jane.doe@example.com or call (312) 555-1037 / +1 312.555.1038")).toBe("Email [email] or call [phone] / [phone]");
    expect(redact("SSN 123-45-6789, card 4242 4242 4242 4242, acct 000123456789")).toBe("SSN [ssn], card [number], acct [number]");
    expect(redact("Unit 4B rent $1,550 due 2026-12-01")).toBe("Unit 4B rent $1,550 due 2026-12-01");
  });
});

describe("free providers", () => {
  it("are only switched on when their keys are set (Ollama needs none)", () => {
    expect(freeConfig("groq", {})).toBeNull();
    expect(freeConfig("cloudflare", { CLOUDFLARE_ACCOUNT_ID: "acc" })).toBeNull();
    expect(freeConfig("cloudflare", { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_AI_TOKEN: "t" })!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions");
    expect(freeConfig("ollama", {})!.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(buildLlmProvider({}).name).toBe("mock");
    expect(buildLlmProvider({ LLM_PROVIDER: "groq" }).name).toBe("mock"); // no key → built-in helper
    expect(buildLlmProvider({ LLM_PROVIDER: "groq", GROQ_API_KEY: "k", LLM_MODEL: "llama-x" })).toMatchObject({ name: "groq", model: "llama-x" });
  });

  it("sends redacted text to cloud services but the original to Ollama", async () => {
    const calls = fakeFetch([ok("Draft one"), ok("Draft two")]);
    const groq = new OpenAiCompatibleProvider("groq", "m", "https://api.groq.com/openai/v1/chat/completions", "key");
    expect(await groq.complete({ purpose: "draft-reply", system: "Be kind", messages: [{ role: "user", content: "From sam@example.com: leak" }] })).toBe("Draft one");
    expect(calls[0]!.auth).toBe("Bearer key");
    expect(JSON.stringify(calls[0]!.body.messages)).toContain("[email]");
    expect(JSON.stringify(calls[0]!.body.messages)).not.toContain("sam@example.com");
    const ollama = new OpenAiCompatibleProvider("ollama", "m", "http://127.0.0.1:11434/v1/chat/completions", null);
    await ollama.complete({ purpose: "draft-reply", messages: [{ role: "user", content: "From sam@example.com: leak" }] });
    expect(JSON.stringify(calls[1]!.body.messages)).toContain("sam@example.com");
    expect(calls[1]!.auth).toBeUndefined();
  });

  it("assistant tool calls go out as OpenAI functions and come back parsed", async () => {
    const calls = fakeFetch([ok("", [{ id: "c1", type: "function", function: { name: "list_vacancies", arguments: "{\"propertyId\":\"p1\"}" } }])]);
    const p = new OpenAiCompatibleProvider("cloudflare", "m", "https://cf.test", "t");
    const r = await p.chat({ system: "s", turns: [{ role: "user", content: "What's vacant?" }], tools: [{ name: "list_vacancies", description: "d", input_schema: { type: "object" } }] });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "list_vacancies", input: { propertyId: "p1" } }]);
    expect((calls[0]!.body.tools as { function: { name: string } }[])[0]!.function.name).toBe("list_vacancies");
  });
});

describe("fallback when a free quota runs out", () => {
  const groq = new OpenAiCompatibleProvider("groq", "g", "https://groq.test", "k");
  const router = new OpenAiCompatibleProvider("openrouter", "o", "https://openrouter.test", "k");

  it("429 → next provider; everything down → the built-in helper (never an error)", async () => {
    let now = 1_000_000;
    const llm = new ResilientLlm([groq, router], new MockLlmProvider(), { dailyLimit: 100, coolDownMs: 60_000, now: () => now });
    const calls = fakeFetch([status(429), ok("from openrouter")]);
    expect(await llm.complete({ purpose: "improve-text", messages: [{ role: "user", content: "hello there" }] })).toBe("from openrouter");
    expect(calls.map((c) => c.url)).toEqual(["https://groq.test", "https://openrouter.test"]);
    // Groq is benched during the cool-down: the next call goes straight to OpenRouter, which is down too.
    const later = fakeFetch([status(503)]);
    const text = await llm.complete({ purpose: "improve-text", messages: [{ role: "user", content: "hello there" }] });
    expect(later.map((c) => c.url)).toEqual(["https://openrouter.test"]);
    expect(text).toMatch(/Hello there\./); // built-in helper's tidy-up
    // After the cool-down Groq is tried again.
    now += 61_000;
    const again = fakeFetch([ok("groq is back")]);
    expect(await llm.complete({ purpose: "improve-text", messages: [{ role: "user", content: "x" }] })).toBe("groq is back");
    expect(again[0]!.url).toBe("https://groq.test");
  });

  it("stops calling a provider after its daily limit", async () => {
    const llm = new ResilientLlm([groq], new MockLlmProvider(), { dailyLimit: 2, coolDownMs: 60_000, now: () => Date.UTC(2026, 10, 9, 12) });
    const calls = fakeFetch([ok("1"), ok("2"), ok("3")]);
    for (let i = 0; i < 3; i++) await llm.complete({ purpose: "improve-text", messages: [{ role: "user", content: "hi" }] });
    expect(calls).toHaveLength(2);
  });
});
