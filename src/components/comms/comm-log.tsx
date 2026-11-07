import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import type { AppContext } from "@/server/context";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Item = { id: string; at: Date; kind: string; direction: string; title: string; body: string };

/** Per-entity communication log: messages, announcements and emails with one tenant or owner. */
export async function CommLog({ ctx, who, email }: { ctx: AppContext; who: { tenantId?: string; ownerId?: string }; email: string | null }) {
  const party = who.tenantId ? `T:${who.tenantId}` : `O:${who.ownerId}`;
  const [msgs, deliveries, emails] = await Promise.all([
    ctx.db.message.findMany({ where: { conversation: who.tenantId ? { tenantId: who.tenantId } : { ownerId: who.ownerId } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, createdAt: true, channel: true, direction: true, body: true, authorName: true, conversationId: true } }),
    ctx.db.announcementDelivery.findMany({ where: who.tenantId ? { tenantId: who.tenantId } : { ownerId: who.ownerId }, include: { announcement: { select: { title: true, body: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    email ? ctx.db.emailMessage.findMany({ where: { to: email }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, createdAt: true, subject: true } }) : Promise.resolve([]),
  ]);
  const items: Item[] = [
    ...msgs.map((m) => ({ id: m.id, at: m.createdAt, kind: m.channel === "NOTE" ? "Note" : m.channel === "PORTAL" ? "Portal" : m.channel === "SMS" ? "SMS" : "Email", direction: m.direction, title: m.direction === "IN" ? `From ${m.authorName}` : `By ${m.authorName}`, body: m.body })),
    ...deliveries.map((d) => ({ id: d.id, at: d.createdAt, kind: `Announcement · ${d.channel.toLowerCase()}`, direction: "OUT", title: `${d.announcement.title}${d.status !== "SENT" ? ` (${d.status.toLowerCase()})` : ""}`, body: d.announcement.body })),
    ...emails.map((e) => ({ id: e.id, at: e.createdAt, kind: "Email", direction: "OUT", title: e.subject, body: "" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const conv = msgs[0]?.conversationId;
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Button asChild size="sm"><Link href={conv ? `/app/communications?c=${conv}` : `/app/communications?to=${encodeURIComponent(party)}`}>{conv ? "Open conversation" : "Send a message"}</Link></Button>
      </div>
      {items.length ? (
        <ol className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
          {items.map((i) => (
            <li key={i.id} className="flex gap-3 px-4 py-3 text-sm">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{i.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={i.direction === "IN" ? "primary" : "outline"}>{i.direction === "IN" ? "Received" : "Sent"} · {i.kind}</Badge><span className="font-medium">{i.title}</span></div>
                {i.body ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{i.body}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : <EmptyState icon={<MessagesSquare />} title="No communications yet" description="Portal messages, texts, emails and announcements will appear here." />}
    </div>
  );
}
