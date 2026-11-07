/**
 * LlmProvider adapter. Default: a deterministic mock (no keys). Set LLM_PROVIDER=anthropic and
 * ANTHROPIC_API_KEY to use Claude; LLM_MODEL picks the model (default claude-sonnet-5-5).
 */
export type LlmMessage = { role: "user" | "assistant"; content: string };
export type LlmRequest = { system?: string; messages: LlmMessage[]; maxTokens?: number; purpose: string };

export type LlmTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: { id: string; name: string; input: Record<string, unknown> }[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type ChatResult = { text: string; toolCalls: { id: string; name: string; input: Record<string, unknown> }[] };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): Promise<string>;
  /** Tool-using chat turn (the assistant). */
  chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[]; maxTokens?: number }): Promise<ChatResult>;
}

class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock";
  /** Deterministic tool routing so the assistant is demoable offline. */
  async chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[] }): Promise<ChatResult> {
    const last = req.turns.at(-1)!;
    if (last.role === "tool") {
      // Summarize the most recent tool results for the user.
      const results = [];
      for (let i = req.turns.length - 1; i >= 0 && req.turns[i]!.role === "tool"; i--) results.unshift(req.turns[i] as Extract<ChatTurn, { role: "tool" }>);
      return { text: results.map((r) => r.content).join("\n\n"), toolCalls: [] };
    }
    const q = last.content.trim();
    const lower = q.toLowerCase();
    const call = (name: string, input: Record<string, unknown>) => ({ text: "", toolCalls: [{ id: `call_${name}_${Date.now().toString(36)}`, name, input }] });
    const nameAfter = (re: RegExp) => q.match(re)?.[1]?.replace(/[?.!,]+$/, "").trim();
    if (/\b(who owes|delinquen|behind on rent|late on rent|past due)\b/.test(lower)) return call("list_delinquent", {});
    if (/\bvacan/.test(lower)) return call("list_vacancies", {});
    if (/\b(open|pending) (tasks|work orders|requests)|maintenance backlog/.test(lower)) return call("list_open_tasks", {});
    if (/\b(p&l|profit|net income|income this|how much did we (make|collect))/.test(lower)) return call("report_summary", { report: "profit-loss" });
    if (/\b(rent roll|occupancy)\b/.test(lower)) return call("report_summary", { report: "rent-roll" });
    const bal = nameAfter(/balance (?:for|of) (.+)$/i) ?? nameAfter(/(?:how much does|what does) (.+?) owe/i);
    if (bal) return call("get_tenant_balance", { name: bal });
    const task = q.match(/(?:create|add|make) (?:a )?(?:task|work order)(?: to| for)? (.+)$/i)?.[1];
    if (task) return call("create_task", { title: task.replace(/^to /i, "").replace(/^./, (c) => c.toUpperCase()), priority: /urgent|asap|emergency/i.test(task) ? "URGENT" : "NORMAL" });
    const msg = q.match(/(?:text|message|send (?:a )?(?:text|message) to) ([A-Z][\w'-]+(?: [A-Z][\w'-]+)?)[,:]? (?:saying |that )?(.+)$/);
    if (msg) return call("send_message", { name: msg[1], body: msg[2], channel: /\btext\b/i.test(q) ? "SMS" : "PORTAL" });
    const find = nameAfter(/(?:find|look up|search for|show me) (.+)$/i);
    if (find) return call("search", { query: find });
    return { text: "I can look things up and take actions for you. Try: “Who owes rent?”, “What's the balance for Riley Garcia?”, “Show vacancies”, “Create a task to replace the hallway bulb at Maple Court”, or “Text Riley Garcia that the plumber is on the way”.", toolCalls: [] };
  }
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
    if (req.purpose === "draft-reply") {
      const last = [...input.matchAll(/^([^:\n]+): (.*)$/gm)].filter((m) => !/^(Contact|Conversation)$/.test(m[1]!)).at(-1);
      const name = (input.match(/^Contact: ([^(\n]+)/m)?.[1] ?? "there").trim().split(" ")[0];
      const said = (last?.[2] ?? "").toLowerCase();
      const sign = req.system?.match(/Sign as ([^.]+)\./)?.[1] ?? "The team";
      const body = /leak|broken|repair|fix|not working|heat|water|clog|mold/.test(said)
        ? "Thanks for letting us know — I'm sorry about the trouble. I've passed this to our maintenance team and someone will contact you to schedule a visit. If it's an emergency (flooding, no heat, gas smell), please call our emergency line right away."
        : /pay|rent|balance|late|fee|charge/.test(said)
          ? "Thanks for reaching out. You can see your balance and pay any time in the resident portal under Pay, and set up autopay there too. If something on your ledger looks wrong, reply here and I'll take a look."
          : /lease|renew|move/.test(said)
            ? "Thanks for your message. I'll review your lease details and get back to you shortly with next steps."
            : "Thanks for your message — I'll look into this and get back to you shortly.";
      return `Hi ${name},\n\n${body}\n\nBest,\n${sign}`;
    }
    if (req.purpose === "improve-text") {
      const clean = input.replace(/[ \t]+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).trim();
      const punct = /[.!?]$/.test(clean) ? clean : `${clean}.`;
      return /thank/i.test(punct) ? punct : `${punct}\n\nThank you!`;
    }
    if (req.purpose === "listing-description") {
      const f = Object.fromEntries(input.split("\n").map((l) => l.split(": ")).filter((x) => x.length >= 2).map(([k, ...v]) => [k, v.join(": ")]));
      const size = [f.Bedrooms ? `${f.Bedrooms}-bedroom` : null, f.Bathrooms ? `${f.Bathrooms}-bath` : null].filter(Boolean).join(", ");
      const p1 = `Welcome home to ${f.Unit ? `unit ${f.Unit} at ` : ""}${(f.Property ?? "this property").split(" (")[0]}${size ? ` — a ${size} home` : ""}${f["Square feet"] ? ` with ${f["Square feet"]} square feet of living space` : ""}.`;
      const p2 = f.Amenities ? `Highlights include ${f.Amenities.toLowerCase()}.` : "The home is freshly prepared for its next resident.";
      const p3 = `Rent is ${f.Rent ?? "listed above"}. Pets: ${(f.Pets ?? "ask us").toLowerCase()}. Schedule a showing or apply online today.`;
      return [p1, p2, p3].join("\n\n");
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
  constructor(readonly apiKey: string, readonly model: string) {}
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
  async chat(req: { system: string; turns: ChatTurn[]; tools: LlmTool[]; maxTokens?: number }): Promise<ChatResult> {
    const messages: { role: "user" | "assistant"; content: unknown }[] = [];
    for (const t of req.turns) {
      if (t.role === "user") messages.push({ role: "user", content: t.content });
      else if (t.role === "assistant") messages.push({ role: "assistant", content: [...(t.content ? [{ type: "text", text: t.content }] : []), ...(t.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input }))] });
      else {
        const prev = messages.at(-1);
        const block = { type: "tool_result", tool_use_id: t.toolCallId, content: t.content };
        if (prev?.role === "user" && Array.isArray(prev.content)) (prev.content as unknown[]).push(block);
        else messages.push({ role: "user", content: [block] });
      }
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, max_tokens: req.maxTokens ?? 1024, system: req.system, tools: req.tools, messages }),
    });
    if (!res.ok) throw new Error(`LLM request failed (${res.status})`);
    const json = (await res.json()) as { content: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[] };
    return {
      text: json.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("").trim(),
      toolCalls: json.content.filter((c): c is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => c.type === "tool_use").map((c) => ({ id: c.id, name: c.name, input: c.input })),
    };
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
