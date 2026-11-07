/**
 * LlmProvider adapter. Default: a deterministic mock (no keys). Set LLM_PROVIDER=anthropic and
 * ANTHROPIC_API_KEY to use Claude; LLM_MODEL picks the model (default claude-sonnet-5-5).
 */
export type LlmMessage = { role: "user" | "assistant"; content: string };
export type LlmRequest = { system?: string; messages: LlmMessage[]; maxTokens?: number; purpose: string };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<string>;
}

class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock";
  /** Purpose-specific canned behavior so features are demoable offline. */
  async complete(req: LlmRequest): Promise<string> {
    const input = req.messages.at(-1)?.content ?? "";
    if (req.purpose === "inspection-summary") {
      const lines = input.split("\n").filter((l) => /\b(POOR|DAMAGED|FAIR)\b/.test(l));
      const damaged = lines.filter((l) => /DAMAGED/.test(l));
      const poor = lines.filter((l) => /POOR/.test(l));
      const fair = lines.filter((l) => /FAIR/.test(l));
      const clean = (l: string) => l.replace(/^-\s*/, "").replace(/\s*:\s*(POOR|DAMAGED|FAIR)/, "").trim();
      if (!lines.length) return "Overall condition is good. No items were rated fair, poor or damaged, and no follow-up work is needed.";
      const parts = [`${lines.length} item${lines.length === 1 ? "" : "s"} need${lines.length === 1 ? "s" : ""} attention.`];
      if (damaged.length) parts.push(`Damaged: ${damaged.map(clean).join("; ")} — consider charging repairs against the deposit if beyond normal wear.`);
      if (poor.length) parts.push(`Poor: ${poor.map(clean).join("; ")} — schedule repairs before the next move-in.`);
      if (fair.length) parts.push(`Fair (monitor): ${fair.map(clean).join("; ")}.`);
      return parts.join(" ");
    }
    if (req.purpose === "report-summary") {
      // Input: a title line, then "- Label: value" facts. Produce a short, deterministic narrative.
      const [title = "Report", ...rest] = input.split("\n");
      const facts = rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
      if (!facts.length) return `${title}: nothing to summarize for this period.`;
      const [first, ...more] = facts;
      return `${title.replace(/^Report:\s*/, "")} — ${first}.${more.length ? ` Also: ${more.join("; ")}.` : ""} Figures come straight from the ledger for the filters shown.`;
    }
    return `Summary: ${input.slice(0, 280)}`;
  }
}

class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  constructor(private readonly apiKey: string, readonly model: string) {}
  async complete(req: LlmRequest): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, max_tokens: req.maxTokens ?? 800, system: req.system, messages: req.messages }),
    });
    if (!res.ok) throw new Error(`LLM request failed (${res.status})`);
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    return json.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  }
}

let provider: LlmProvider | undefined;
export function getLlmProvider(): LlmProvider {
  if (provider) return provider;
  provider =
    process.env.LLM_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY
      ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.LLM_MODEL ?? "claude-sonnet-5-5")
      : new MockLlmProvider();
  return provider;
}
