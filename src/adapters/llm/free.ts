import type { ChatResult, ChatTurn, LlmProvider, LlmRequest, LlmTool } from "./index";

/**
 * Free / near-free AI (ship plan §8.1). One OpenAI-compatible client covers:
 *   cloudflare  Workers AI  (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN; free 10,000 neurons/day)
 *   groq        Groq        (GROQ_API_KEY; free tier)
 *   openrouter  OpenRouter  (OPENROUTER_API_KEY; ":free" models)
 *   ollama      Ollama      (OLLAMA_URL, default http://127.0.0.1:11434 — runs on your own computer)
 * ResilientLlm tries the chosen provider, then LLM_FALLBACK providers, then the built-in model, so
 * an AI button never errors because a free quota ran out. Personal details are removed before
 * text goes to a cloud service (Ollama stays on the computer, so it gets the original text).
 */

export type FreeName = "cloudflare" | "groq" | "openrouter" | "ollama";
export const FREE_PROVIDERS: readonly FreeName[] = ["cloudflare", "groq", "openrouter", "ollama"];
export const PROVIDER_LABEL: Record<string, string> = {
  mock: "Built-in helper", cloudflare: "Cloudflare Workers AI", groq: "Groq", openrouter: "OpenRouter", ollama: "Ollama (on this computer)", anthropic: "Claude",
};

type Env = Record<string, string | undefined>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
export function setLlmFetcher(f: Fetcher) { fetcher = f; }

/** Endpoint, key and default model for a free provider; null when it isn't configured. */
export function freeConfig(name: FreeName, env: Env = process.env, model?: string): { url: string; key: string | null; model: string } | null {
  switch (name) {
    case "cloudflare":
      if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_TOKEN) return null;
      return { url: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, key: env.CLOUDFLARE_AI_TOKEN, model: model ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast" };
    case "groq":
      if (!env.GROQ_API_KEY) return null;
      return { url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY, model: model ?? "llama-3.1-8b-instant" };
    case "openrouter":
      if (!env.OPENROUTER_API_KEY) return null;
      return { url: "https://openrouter.ai/api/v1/chat/completions", key: env.OPENROUTER_API_KEY, model: model ?? "meta-llama/llama-3.3-70b-instruct:free" };
    case "ollama":
      return { url: `${(env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/v1/chat/completions`, key: null, model: model ?? "llama3.2:3b" };
  }
}

// ─── Privacy ───────────────────────────────────────────────────────────────────

/** Remove emails, phone numbers, SSNs and long account/card numbers before sending text out. */
export function redact(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[number]")
    .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\b\d{9,11}\b/g, "[number]");
}

// ─── OpenAI-compatible client ─────────────────────────────────────────────────

export class LlmHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type OaiMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string };

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(readonly name: FreeName, readonly model: string, private readonly url: string, private readonly key: string | null) {}
  private get cloud() { return this.name !== "ollama"; }
  private clean(s: string) { return this.cloud ? redact(s) : s; }

  private async post(body: Record<string, unknown>) {
    const res = await fetcher(this.url, { method: "POST", headers: { "content-type": "application/json", ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) }, body: JSON.stringify({ model: this.model, ...body }) });
    if (!res.ok) throw new LlmHttpError(res.status, `${this.name} answered ${res.status}`);
    return (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
  }

  async complete(req: LlmRequest): Promise<string> {
    const messages: OaiMessage[] = [...(req.system ? [{ role: "system" as const, content: req.system }] : []), ...req.messages.map((m) => ({ role: m.role, content: this.clean(m.content) }))];
    const json = await this.post({ messages, max_tokens: req.maxTokens ?? 800, temperature: 0.4 });
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LlmHttpError(502, `${this.name} returned no text`);
    return text;
  }

  async chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[]; maxTokens?: number }): Promise<ChatResult> {
    const messages: OaiMessage[] = [{ role: "system", content: req.system }];
    for (const t of req.turns) {
      if (t.role === "user") messages.push({ role: "user", content: this.clean(t.content) });
      else if (t.role === "assistant") messages.push({ role: "assistant", content: t.content || null, ...(t.toolCalls?.length ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
      else messages.push({ role: "tool", tool_call_id: t.toolCallId, name: t.name, content: this.clean(t.content) });
    }
    const json = await this.post({ messages, max_tokens: req.maxTokens ?? 1024, temperature: 0.2, tools: req.tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })) });
    const m = json.choices?.[0]?.message;
    if (!m) throw new LlmHttpError(502, `${this.name} returned nothing`);
    const toolCalls = (m.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>; } catch { /* a bad argument string → no arguments */ }
      return { id: c.id, name: c.function.name, input };
    });
    return { text: (m.content ?? "").trim(), toolCalls };
  }
}

// ─── Fallback chain ───────────────────────────────────────────────────────────

/**
 * Tries each provider in order. A provider that's out of quota (429) or failing (5xx, timeout,
 * no answer) is skipped for a cool-down; after LLM_DAILY_LIMIT calls in a UTC day it's skipped
 * until tomorrow. The last link is always the built-in model, which never fails.
 */
export class ResilientLlm implements LlmProvider {
  private downUntil = new Map<string, number>();
  private used = new Map<string, { day: string; n: number }>();
  constructor(private readonly chain: LlmProvider[], private readonly last: LlmProvider, private readonly opts: { dailyLimit: number; coolDownMs: number; now?: () => number } = { dailyLimit: 500, coolDownMs: 10 * 60_000 }) {}
  get name() { return this.chain[0]?.name ?? this.last.name; }
  get model() { return this.chain[0]?.model ?? this.last.model; }
  private now() { return this.opts.now?.() ?? Date.now(); }

  private available(p: LlmProvider) {
    if ((this.downUntil.get(p.name) ?? 0) > this.now()) return false;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const u = this.used.get(p.name);
    return !u || u.day !== day || u.n < this.opts.dailyLimit;
  }
  private count(p: LlmProvider) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const u = this.used.get(p.name);
    this.used.set(p.name, u && u.day === day ? { day, n: u.n + 1 } : { day, n: 1 });
  }

  private async run<T>(fn: (p: LlmProvider) => Promise<T>): Promise<T> {
    for (const p of this.chain) {
      if (!this.available(p)) continue;
      this.count(p);
      try {
        return await fn(p);
      } catch (e) {
        const status = e instanceof LlmHttpError ? e.status : 0;
        // Bad requests (400) aren't the provider's fault: try the next one, but don't bench this one.
        if (status === 0 || status === 429 || status >= 500 || status === 401 || status === 403) this.downUntil.set(p.name, this.now() + this.opts.coolDownMs);
        console.warn(`[ai] ${p.name} unavailable (${status || "no answer"}) — trying the next option`);
      }
    }
    return fn(this.last);
  }

  complete(req: LlmRequest) { return this.run((p) => p.complete(req)); }
  chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[]; maxTokens?: number }) { return this.run((p) => p.chat(req)); }
}
