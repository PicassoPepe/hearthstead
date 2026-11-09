import type { WorkersAi } from "@/server/runtime";
import { LlmHttpError, redact } from "./free";
import type { ChatResult, ChatTurn, LlmProvider, LlmRequest, LlmTool } from "./index";

type ToolCall = { id?: string; function?: { name?: string; arguments?: string } };

/**
 * Cloudflare Workers AI via the `AI` binding (`env.AI.run`). Used when the app is running on
 * Workers. The REST API in free.ts stays for Node hosts that only have an API token.
 * Text is redacted the same way as the other cloud providers.
 */
export class WorkersAiProvider implements LlmProvider {
  readonly name = "cloudflare";
  constructor(private readonly ai: WorkersAi, readonly model: string) {}

  private async run(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let json: unknown;
    try {
      json = await this.ai.run(this.model, body);
    } catch (e) {
      const status = typeof e === "object" && e && "status" in e && typeof (e as { status: unknown }).status === "number" ? (e as { status: number }).status : 0;
      throw new LlmHttpError(status || 502, "Workers AI request failed");
    }
    if (!json || typeof json !== "object") throw new LlmHttpError(502, "Workers AI returned nothing");
    return json as Record<string, unknown>;
  }

  async complete(req: LlmRequest): Promise<string> {
    const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages.map((m) => ({ role: m.role, content: redact(m.content) }))];
    const json = await this.run({ messages, max_tokens: req.maxTokens ?? 800 });
    const text = textOf(json);
    if (!text) throw new LlmHttpError(502, "Workers AI returned no text");
    return text;
  }

  async chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[]; maxTokens?: number }): Promise<ChatResult> {
    const messages: { role: string; content: string | null; tool_call_id?: string; name?: string }[] = [{ role: "system", content: req.system }];
    for (const t of req.turns) {
      if (t.role === "user") messages.push({ role: "user", content: redact(t.content) });
      else if (t.role === "assistant") messages.push({ role: "assistant", content: t.content ? redact(t.content) : null });
      else messages.push({ role: "tool", tool_call_id: t.toolCallId, name: t.name, content: redact(t.content) });
    }
    const json = await this.run({
      messages,
      max_tokens: req.maxTokens ?? 1024,
      tools: req.tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.input_schema } })),
    });
    const choice = firstChoice(json);
    const calls = (choice?.tool_calls ?? []).map((c, i) => {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(c.function?.arguments || "{}") as Record<string, unknown>; } catch { /* bad arguments → none */ }
      return { id: c.id || `call_${i}`, name: c.function?.name || "", input };
    }).filter((c) => c.name);
    return { text: (choice?.content ?? textOf(json) ?? "").trim(), toolCalls: calls };
  }
}

function textOf(json: Record<string, unknown>): string {
  if (typeof json.response === "string") return json.response.trim();
  return (firstChoice(json)?.content ?? "").trim();
}

function firstChoice(json: Record<string, unknown>): { content?: string | null; tool_calls?: ToolCall[] } | null {
  const choices = json.choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = (choices[0] as { message?: { content?: string | null; tool_calls?: ToolCall[] } } | undefined)?.message;
  return message ?? null;
}
