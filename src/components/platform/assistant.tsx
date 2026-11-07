"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bot, Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { ChatTurn } from "@/adapters/llm";
import type { ProposedAction } from "@/server/ai/assistant";
import { assistantAction, confirmProposalAction } from "@/server/actions/platform";
import { cn } from "@/lib/utils";

type Bubble = { role: "user" | "assistant"; text: string; tools?: string[]; proposals?: (ProposedAction & { state?: "done" | "cancelled"; result?: string })[] };
const SUGGESTIONS = ["Who owes rent?", "Show vacancies", "What's our profit this year?", "Show open work orders", "Create a task to replace the hallway bulb at Maple Court"];

/** Chat with tool use. Writes appear as cards that need an explicit Confirm. */
export function Assistant() {
  const [bubbles, setBubbles] = React.useState<Bubble[]>([]);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [bubbles.length]);
  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBubbles((b) => [...b, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    const r = await assistantAction(turns, q);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); setBubbles((b) => [...b, { role: "assistant", text: `Sorry — ${r.error}` }]); return; }
    setTurns(r.data.turns);
    setBubbles((b) => [...b, { role: "assistant", text: r.data.text || (r.data.proposals.length ? "Here's what I'd do — confirm to go ahead:" : ""), tools: r.data.toolsUsed, proposals: r.data.proposals }]);
  };
  const decide = async (bi: number, pi: number, confirm: boolean) => {
    const p = bubbles[bi]!.proposals![pi]!;
    let result = "Cancelled";
    if (confirm) {
      const r = await confirmProposalAction(p);
      if (!r.ok) return void toast.error(r.error);
      result = r.data;
      toast.success(r.data);
    }
    setBubbles((b) => b.map((x, i) => (i === bi ? { ...x, proposals: x.proposals!.map((y, j) => (j === pi ? { ...y, state: confirm ? "done" : "cancelled", result } : y)) } : x)));
  };
  return (
    <div className="flex h-[calc(100dvh-16rem)] min-h-[480px] flex-col rounded-card border border-border bg-surface shadow-card">
      <ol aria-label="Conversation" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4">
        {!bubbles.length ? (
          <li className="m-auto max-w-md pt-8 text-center text-sm text-muted-foreground">
            <Bot className="mx-auto mb-2 size-8 text-primary" aria-hidden />
            Ask about tenants, balances, vacancies, reports and work orders. I can also draft tasks and messages — nothing is created or sent until you confirm.
            <div className="mt-4 flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-muted">{s}</button>)}</div>
          </li>
        ) : null}
        {bubbles.map((b, bi) => (
          <li key={bi} className={cn("flex", b.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", b.role === "user" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-surface-muted")}>
              {b.text ? <p className="whitespace-pre-wrap">{b.text}</p> : null}
              {b.tools?.length ? <p className="mt-1 text-[11px] text-muted-foreground">Used: {[...new Set(b.tools)].join(", ")}</p> : null}
              {b.proposals?.map((p, pi) => (
                <div key={p.id} className="mt-2 rounded-lg border border-primary/40 bg-surface p-2" role="group" aria-label="Proposed action">
                  <p className="font-medium">{p.summary}</p>
                  {p.state ? <p className="text-xs text-muted-foreground">{p.state === "done" ? `✓ ${p.result}` : "Cancelled"}</p> : (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => decide(bi, pi, true)}><Check aria-hidden /> Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(bi, pi, false)}><X aria-hidden /> Cancel</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
        {busy ? <li className="text-sm text-muted-foreground">Thinking…</li> : null}
        <div ref={end} />
      </ol>
      <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <Textarea aria-label="Ask the assistant" rows={1} className="min-h-10 flex-1 resize-none" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }} placeholder="Ask anything about your portfolio…" />
        <Button type="submit" loading={busy} disabled={!input.trim()} aria-label="Send"><Send aria-hidden /></Button>
      </form>
    </div>
  );
}
