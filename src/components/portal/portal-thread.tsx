"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/server/action-result";
import { cn } from "@/lib/utils";

export type PortalMsg = { id: string; mine: boolean; author: string; body: string; at: string; channel: string };

/** Two-way thread with the manager, shared by the tenant and owner portals. */
export function PortalThread({ messages, send, readOnly, orgName }: { messages: PortalMsg[]; send: (body: string) => Promise<ActionResult>; readOnly?: boolean; orgName: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-3">
      <ol aria-label="Messages" className="grid gap-3 rounded-card border border-border bg-surface-muted/30 p-3">
        {messages.map((m) => (
          <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[15px] shadow-card", m.mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-surface")}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={cn("mt-1 text-xs", m.mine ? "text-primary-foreground/80" : "text-muted-foreground")}>{m.mine ? "You" : m.author}{m.channel === "SMS" ? " · by text" : ""} · {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
            </div>
          </li>
        ))}
        {!messages.length ? <li className="p-4 text-center text-sm text-muted-foreground">No messages yet. Send {orgName} a note below — you&apos;ll get an email when they reply.</li> : null}
      </ol>
      {!readOnly ? (
        <form className="grid gap-2" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await send(body);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Message sent");
          setBody("");
          router.refresh();
        }}>
          <Textarea aria-label="Add a message" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${orgName}`} />
          <Button type="submit" className="justify-self-end" loading={busy} disabled={!body.trim()}><Send aria-hidden /> Send</Button>
        </form>
      ) : null}
    </div>
  );
}
