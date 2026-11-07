"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquarePlus, Send, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { draftReplyAction, improveTextAction, markReadAction, sendMessageAction, setConversationStatusAction, startConversationAction } from "@/server/actions/comms";
import { cn } from "@/lib/utils";

export type ConvRow = { id: string; name: string; kind: string; preview: string; at: string; unread: number; status: string };
export type Msg = { id: string; direction: string; channel: string; body: string; author: string; at: string; status: string; error: string | null; aiDrafted: boolean };
export type Thread = { id: string; name: string; kind: string; href: string | null; email: string | null; phone: string | null; status: string; optedOut: boolean; messages: Msg[] };
export type ContactOption = { value: string; label: string; group: string };

const CHANNEL: Record<string, string> = { PORTAL: "Portal", SMS: "SMS", EMAIL: "Email", NOTE: "Internal note" };
const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function Inbox({ rows, thread, filter, contacts, usage, canEdit, presetTo }: { rows: ConvRow[]; thread: Thread | null; filter: string; contacts: ContactOption[]; usage: { used: number; limit: number; enabled: boolean }; canEdit: boolean; presetTo?: string }) {
  const router = useRouter();
  const [composeOpen, setComposeOpen] = React.useState(Boolean(presetTo));
  React.useEffect(() => {
    if (!thread || !rows.find((r) => r.id === thread.id)?.unread) return;
    markReadAction(thread.id).then(() => router.refresh(), () => undefined);
  }, [thread, rows, router]);
  const href = (patch: Record<string, string>) => `/app/communications?${new URLSearchParams({ filter, ...(thread ? { c: thread.id } : {}), ...patch })}`;
  const FILTERS = [["all", "All"], ["unread", "Unread"], ["Tenant", "Tenants"], ["Owner", "Owners"], ["Vendor", "Vendors"], ["closed", "Closed"]] as const;
  return (
    <div className="grid h-[calc(100dvh-12rem)] min-h-[520px] overflow-hidden rounded-card border border-border bg-surface shadow-card md:grid-cols-[320px_1fr]">
      <aside aria-label="Conversations" className={cn("flex min-h-0 flex-col border-border md:border-r", thread && "hidden md:flex")}>
        <div className="flex items-center gap-2 border-b border-border p-2">
          <nav aria-label="Inbox filter" className="flex flex-1 gap-1 overflow-x-auto">
            {FILTERS.map(([k, l]) => (
              <Link key={k} href={`/app/communications?filter=${k}`} aria-current={filter === k ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium", filter === k ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</Link>
            ))}
          </nav>
          {canEdit ? <Button size="icon-sm" aria-label="New message" onClick={() => setComposeOpen(true)}><MessageSquarePlus aria-hidden /></Button> : null}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={href({ c: r.id })} aria-current={thread?.id === r.id ? "true" : undefined} className={cn("block px-3 py-2.5 hover:bg-surface-muted/60", thread?.id === r.id && "bg-primary-soft/50")}>
                <div className="flex items-center gap-2">
                  <span className={cn("flex-1 truncate text-sm", r.unread ? "font-semibold" : "font-medium")}>{r.name}</span>
                  <span className="text-xs text-muted-foreground">{when(r.at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-muted-foreground">{r.preview}</span>
                  {r.unread ? <Badge tone="primary">{r.unread}<span className="sr-only"> unread</span></Badge> : null}
                </div>
                <span className="text-[11px] text-muted-foreground">{r.kind}{r.status === "CLOSED" ? " · closed" : ""}</span>
              </Link>
            </li>
          ))}
          {!rows.length ? <li className="p-6 text-center text-sm text-muted-foreground">No conversations here.</li> : null}
        </ul>
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground" title="SMS segments this month">
          SMS {usage.enabled ? `${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} this month` : "turned off"}
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="SMS used this month" aria-valuenow={usage.used} aria-valuemin={0} aria-valuemax={usage.limit}>
            <div className={cn("h-full rounded-full", usage.used / Math.max(1, usage.limit) > 0.9 ? "bg-danger" : "bg-primary")} style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }} />
          </div>
        </div>
      </aside>
      <section aria-label="Conversation" className={cn("flex min-h-0 flex-col", !thread && "hidden md:flex")}>
        {thread ? <ThreadView key={thread.id} thread={thread} canEdit={canEdit} back={`/app/communications?filter=${filter}`} /> : <div className="m-auto p-6 text-center text-sm text-muted-foreground">Select a conversation, or start a new one.</div>}
      </section>
      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} contacts={contacts} presetTo={presetTo} />
    </div>
  );
}

function ThreadView({ thread, canEdit, back }: { thread: Thread; canEdit: boolean; back: string }) {
  const router = useRouter();
  const canPortal = thread.kind === "Tenant" || thread.kind === "Owner";
  const [channel, setChannel] = React.useState(() => {
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === "IN");
    return lastIn?.channel === "SMS" && !thread.optedOut ? "SMS" : canPortal ? "PORTAL" : thread.phone ? "SMS" : "EMAIL";
  });
  const [body, setBody] = React.useState("");
  const [ai, setAi] = React.useState(false);
  const [busy, setBusy] = React.useState<"" | "send" | "draft" | "improve">("");
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Link href={back} className="text-sm text-primary md:hidden">← Back</Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{thread.href ? <Link href={thread.href} className="hover:underline">{thread.name}</Link> : thread.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{thread.kind}{thread.phone ? ` · ${thread.phone}` : ""}{thread.email ? ` · ${thread.email}` : ""}{thread.optedOut ? " · opted out of texts" : ""}</p>
        </div>
        {canEdit ? <Button size="sm" variant="secondary" onClick={async () => { const r = await setConversationStatusAction(thread.id, thread.status === "CLOSED" ? "OPEN" : "CLOSED"); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }}>{thread.status === "CLOSED" ? "Reopen" : "Close"}</Button> : null}
      </header>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-muted/30 p-4" aria-label="Messages">
        {thread.messages.map((m) => (
          <li key={m.id} className={cn("flex", m.channel === "NOTE" ? "justify-center" : m.direction === "OUT" ? "justify-end" : "justify-start")}>
            {m.channel === "NOTE" ? (
              <div className="max-w-[85%] rounded-lg border border-dashed border-warning/60 bg-warning-soft/40 px-3 py-1.5 text-xs"><span className="font-medium">{m.author}:</span> {m.body} <span className="text-muted-foreground">· {when(m.at)}</span></div>
            ) : (
              <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-card", m.direction === "OUT" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-surface")}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cn("mt-1 text-[11px]", m.direction === "OUT" ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {m.author} · {CHANNEL[m.channel]} · {when(m.at)}{m.aiDrafted ? " · AI-drafted" : ""}{m.status === "FAILED" ? ` · failed: ${m.error ?? ""}` : ""}
                </p>
              </div>
            )}
          </li>
        ))}
        <div ref={end} />
      </ol>
      {canEdit ? (
        <form
          className="grid gap-2 border-t border-border p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("send");
            const r = await sendMessageAction(thread.id, { body, channel, aiDrafted: ai });
            setBusy("");
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            setBody("");
            setAi(false);
            router.refresh();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium" htmlFor="channel">Send as</label>
            <NativeSelect id="channel" className="w-40" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {canPortal ? <option value="PORTAL">Portal message</option> : null}
              <option value="SMS" disabled={!thread.phone || thread.optedOut}>SMS{!thread.phone ? " (no mobile)" : thread.optedOut ? " (opted out)" : ""}</option>
              <option value="EMAIL" disabled={!thread.email}>Email{!thread.email ? " (no email)" : ""}</option>
              <option value="NOTE">Internal note</option>
            </NativeSelect>
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="secondary" loading={busy === "draft"} onClick={async () => {
                setBusy("draft");
                const r = await draftReplyAction(thread.id);
                setBusy("");
                if (!r.ok) return void toast.error(r.error);
                setBody(r.data);
                setAi(true);
              }}><Sparkles aria-hidden /> AI draft</Button>
              <Button type="button" size="sm" variant="secondary" disabled={!body.trim()} loading={busy === "improve"} onClick={async () => {
                setBusy("improve");
                const r = await improveTextAction(body, "message");
                setBusy("");
                if (!r.ok) return void toast.error(r.error);
                setBody(r.data);
                setAi(true);
              }}><Wand2 aria-hidden /> Improve</Button>
            </div>
          </div>
          <Textarea aria-label="Message" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={channel === "NOTE" ? "Only your team sees notes" : `Reply to ${thread.name}`} />
          <div className="flex items-center gap-2">
            {ai ? <span className="text-xs text-muted-foreground">AI-assisted — review before sending.</span> : null}
            {channel === "SMS" ? <span className="text-xs text-muted-foreground">{body.length} chars · {body.length <= 160 ? 1 : Math.ceil(body.length / 153)} segment(s)</span> : null}
            <Button type="submit" className="ml-auto" loading={busy === "send"} disabled={!body.trim()}><Send aria-hidden /> {channel === "NOTE" ? "Add note" : "Send"}</Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function ComposeDialog({ open, onOpenChange, contacts, presetTo }: { open: boolean; onOpenChange: (o: boolean) => void; contacts: ContactOption[]; presetTo?: string }) {
  const router = useRouter();
  const [to, setTo] = React.useState(presetTo ?? "");
  const [q, setQ] = React.useState("");
  const [channel, setChannel] = React.useState("PORTAL");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const shown = contacts.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New message</DialogTitle><DialogDescription>Message a tenant, owner or vendor. Replies land in this inbox.</DialogDescription></DialogHeader>
        <DialogBody className="grid gap-3">
          <Field label="Search contacts">{(a) => <Input {...a} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name" />}</Field>
          <Field label="To" required>{(a) => (
            <NativeSelect {...a} value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value.startsWith("V:")) setChannel("SMS"); }}>
              <option value="">Choose…</option>
              {groups.map((g) => <optgroup key={g} label={g}>{shown.filter((c) => c.group === g).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>)}
            </NativeSelect>
          )}</Field>
          <Field label="Channel">{(a) => (
            <NativeSelect {...a} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="PORTAL" disabled={to.startsWith("V:")}>Portal message</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
            </NativeSelect>
          )}</Field>
          <Field label="Message" required>{(a) => <Textarea {...a} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} disabled={!to || !body.trim()} onClick={async () => {
            setBusy(true);
            const r = await startConversationAction({ party: to, body, channel });
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Message sent");
            onOpenChange(false);
            setBody("");
            router.push(`/app/communications?c=${r.data.id}`);
          }}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
