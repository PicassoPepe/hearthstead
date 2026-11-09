import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parseInboundEmail } from "@/adapters/email/inbound";
import { ResendEmailProvider, setResendFetch } from "@/adapters/email/resend";
import { secretsMatch, verifyResendSignature } from "@/adapters/email/signature";
import { WorkersAiProvider } from "@/adapters/llm/workers-ai";
import { kentuckyDay, NIGHTLY_CRON, scheduledJob } from "@/server/jobs/scheduled";
import { aiProbe, assembleHealth, emailProbe } from "@/server/ops/public-health";
import type { PrismaClient } from "@prisma/client";

afterEach(() => setResendFetch((url, init) => fetch(url, init)));

describe("Resend email", () => {
  it("posts to the HTTPS API and records the message", async () => {
    const rows: Record<string, unknown>[] = [];
    const db = { emailMessage: { create: async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); return { id: "row" }; } } } as unknown as PrismaClient;
    let seen: { url: string; auth: string; body: Record<string, unknown> } | undefined;
    setResendFetch(async (url, init) => {
      const headers = init.headers as Record<string, string>;
      seen = { url, auth: headers.authorization ?? "", body: JSON.parse(String(init.body)) as Record<string, unknown> };
      return Response.json({ id: "re_123" });
    });
    const sent = await new ResendEmailProvider("re_key", "DeedWood <no-reply@deedwood.test>", db).send({
      to: "Tenant@Example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi", organizationId: "org1",
    });
    expect(sent).toEqual({ id: "re_123", provider: "resend" });
    expect(seen?.url).toBe("https://api.resend.com/emails");
    expect(seen?.auth).toBe("Bearer re_key");
    expect(seen?.body.from).toBe("DeedWood <no-reply@deedwood.test>");
    expect(seen?.body.to).toEqual(["Tenant@Example.com"]);
    expect(rows[0]).toMatchObject({ provider: "resend", to: "tenant@example.com", organizationId: "org1" });
  });

  it("does not record a message when Resend rejects it", async () => {
    const db = { emailMessage: { create: async () => { throw new Error("should not record"); } } } as unknown as PrismaClient;
    setResendFetch(async () => new Response("no", { status: 422 }));
    await expect(new ResendEmailProvider("k", "from@test", db).send({ to: "a@b.c", subject: "s", html: "h" })).rejects.toThrow(/422/);
  });
});

describe("inbound email signatures", () => {
  const secret = `whsec_${Buffer.from("deedwood-test-secret").toString("base64")}`;
  const payload = JSON.stringify({ type: "email.received" });
  const id = "msg_1";
  const timestamp = "1700000000";
  const sig = createHmac("sha256", Buffer.from("deedwood-test-secret")).update(`${id}.${timestamp}.${payload}`).digest("base64");

  it("accepts a fresh Svix signature and rejects a bad one", () => {
    const now = 1700000000 * 1000;
    expect(verifyResendSignature(payload, { id, timestamp, signature: `v1,${sig}` }, secret, now)).toBe(true);
    expect(verifyResendSignature(payload, { id, timestamp, signature: "v1,bm90aGluZw==" }, secret, now)).toBe(false);
    expect(verifyResendSignature(payload, { id, timestamp, signature: `v1,${sig}` }, secret, now + 10 * 60_000)).toBe(false);
  });

  it("compares shared secrets without treating a different length as equal", () => {
    expect(secretsMatch("same-value", "same-value")).toBe(true);
    expect(secretsMatch("same-value", "same-valuE")).toBe(false);
    expect(secretsMatch("short", "much-longer-value")).toBe(false);
    expect(secretsMatch(null, "x")).toBe(false);
  });
});

describe("inbound email parsing", () => {
  it("reads a Resend event and a forwarder body", () => {
    expect(parseInboundEmail({ type: "email.received", data: { from: "Riley <riley@example.com>", subject: "Leak", email_id: "em_1" } }, "svix")).toEqual({
      from: "riley@example.com", subject: "Leak", text: "", externalId: "em_1", resendEmailId: "em_1",
    });
    expect(parseInboundEmail({ from: "owner@example.com", subject: "Hi", text: "Thanks", messageId: "m1" }, "fallback")).toMatchObject({
      from: "owner@example.com", text: "Thanks", externalId: "m1", resendEmailId: null,
    });
    expect(parseInboundEmail({ from: "not-an-email" }, "x")).toBeNull();
  });
});

describe("Workers AI binding provider", () => {
  it("sends redacted text and reads the binding's response", async () => {
    let body: Record<string, unknown> | undefined;
    const ai = { run: async (_model: string, input: Record<string, unknown>) => { body = input; return { response: "Draft ready" }; } };
    const text = await new WorkersAiProvider(ai, "@cf/meta/llama").complete({
      purpose: "draft-reply", messages: [{ role: "user", content: "Email sam@example.com about the leak" }],
    });
    expect(text).toBe("Draft ready");
    expect(JSON.stringify(body?.messages)).toContain("[email]");
    expect(JSON.stringify(body?.messages)).not.toContain("sam@example.com");
  });

  it("parses tool calls from an OpenAI-shaped binding response", async () => {
    const ai = { run: async () => ({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", function: { name: "list_vacancies", arguments: "{\"propertyId\":\"p1\"}" } }] } }] }) };
    const result = await new WorkersAiProvider(ai, "m").chat({
      system: "s", turns: [{ role: "user", content: "What's vacant?" }], tools: [{ name: "list_vacancies", description: "d", input_schema: { type: "object" } }],
    });
    expect(result.toolCalls).toEqual([{ id: "c1", name: "list_vacancies", input: { propertyId: "p1" } }]);
  });
});

describe("cron schedule", () => {
  it("maps the two Cloudflare triggers and ignores anything else", () => {
    expect(scheduledJob(NIGHTLY_CRON)).toBe("nightly");
    expect(scheduledJob("* * * * *")).toBe("minutely");
    expect(scheduledJob("0 0 * * *")).toBeNull();
  });

  it("uses the Kentucky calendar day, including after midnight UTC", () => {
    expect(kentuckyDay(new Date("2026-11-09T04:30:00Z"))).toBe("2026-11-08");
    expect(kentuckyDay(new Date("2026-11-09T15:07:00Z"))).toBe("2026-11-09");
  });
});

describe("public health", () => {
  it("is ok only when the database and storage answer, and never needs a secret in the body", () => {
    const body = assembleHealth({ db: true, storage: true, ai: "off", email: "off", paymentsOn: false, version: "abc" });
    expect(body).toEqual({ ok: true, db: "ok", storage: "ok", ai: "off", email: "off", payments: "off", version: "abc" });
    expect(assembleHealth({ db: false, storage: true, ai: "ok", email: "ok", paymentsOn: true, version: "abc" }).ok).toBe(false);
  });

  it("reports AI and email from configuration only", () => {
    expect(aiProbe({})).toBe("off");
    expect(aiProbe({ LLM_PROVIDER: "cloudflare" })).toBe("down");
    expect(aiProbe({ LLM_PROVIDER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_AI_TOKEN: "t" })).toBe("ok");
    expect(aiProbe({ LLM_PROVIDER: "groq", GROQ_API_KEY: "k" })).toBe("ok");
    expect(emailProbe({})).toBe("off");
    expect(emailProbe({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" })).toBe("off");
    expect(emailProbe({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "DeedWood <no-reply@deedwood.test>" })).toBe("ok");
  });
});
