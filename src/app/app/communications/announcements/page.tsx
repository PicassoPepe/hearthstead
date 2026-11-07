import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Badge } from "@/components/ui/badge";
import { AnnouncementComposer, CancelAnnouncementButton } from "@/components/comms/announcement-composer";
import { sendDueAnnouncements, type Audience } from "@/server/comms/announcements";
import { smsUsage } from "@/server/comms/service";

export const metadata = { title: "Announcements" };

const AUD: Record<string, string> = { ALL_TENANTS: "All tenants", PROPERTY_TENANTS: "Tenants at", ALL_OWNERS: "All owners", PROPERTY_OWNERS: "Owners of" };
const fmt = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AnnouncementsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "communications", "view")) return <Forbidden what="communications" />;
  // The worker sends scheduled announcements every minute; this catches up if it isn't running.
  if (can(ctx.permissions, "communications", "edit")) await sendDueAnnouncements(ctx.db);
  const [list, props, usage, stats] = await Promise.all([
    ctx.db.announcement.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    smsUsage(ctx.db),
    ctx.db.announcementDelivery.groupBy({ by: ["announcementId", "status"], _count: true }),
  ]);
  const pn = new Map(props.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader eyebrow="Communications" title="Announcements" description="Send notices to tenants or owners by portal, email and text — now or on a schedule." />
      {can(ctx.permissions, "communications", "edit") ? <div className="mb-6"><AnnouncementComposer properties={props} smsEnabled={usage.enabled} /></div> : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Announcements</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Title", "Audience", "Channels", "Status", "Delivered", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
          <tbody>
            {list.map((a) => {
              const aud = a.audience as Audience;
              const s = (st: string) => stats.find((x) => x.announcementId === a.id && x.status === st)?._count ?? 0;
              return (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="px-3 py-2"><div className="font-medium">{a.title}</div><div className="line-clamp-2 max-w-md text-xs text-muted-foreground">{a.body}</div></td>
                  <td className="px-3 py-2">{AUD[aud.type]}{aud.propertyIds?.length ? ` ${aud.propertyIds.map((id) => pn.get(id)).join(", ")}` : ""}</td>
                  <td className="px-3 py-2">{a.channels.map((c) => <Badge key={c} tone="outline" className="mr-1">{c.toLowerCase()}</Badge>)}</td>
                  <td className="px-3 py-2">{a.status === "SENT" ? <Badge tone="success">Sent {a.sentAt ? fmt(a.sentAt) : ""}</Badge> : a.status === "SCHEDULED" ? <Badge tone="info">Scheduled {a.scheduledFor ? fmt(a.scheduledFor) : ""}</Badge> : <Badge tone="neutral">{a.status === "CANCELED" ? "Canceled" : "Draft"}</Badge>}</td>
                  <td className="px-3 py-2 tabular">{a.status === "SENT" ? <>{s("SENT")} sent{s("SKIPPED") ? ` · ${s("SKIPPED")} skipped` : ""}{s("FAILED") ? ` · ${s("FAILED")} failed` : ""}<div className="text-xs text-muted-foreground">{a.recipientCount} recipients</div></> : "—"}</td>
                  <td className="px-3 py-2 text-right">{a.status === "SCHEDULED" && can(ctx.permissions, "communications", "edit") ? <CancelAnnouncementButton id={a.id} /> : null}</td>
                </tr>
              );
            })}
            {!list.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No announcements yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
