import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ScheduleShowing, ShowingStatusButtons } from "@/components/funnel/funnel-forms";

export const metadata = { title: "Showings" };

export default async function ShowingsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="showings" />;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [showings, listings, prospects, users] = await Promise.all([
    ctx.db.showing.findMany({ where: { startsAt: { gte: since } }, orderBy: { startsAt: "asc" }, take: 300 }),
    ctx.db.listing.findMany({ where: { deletedAt: null }, select: { id: true, title: true, status: true } }),
    ctx.db.prospect.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }),
    ctx.db.membership.findMany({ include: { user: { select: { id: true, name: true } } } }),
  ]);
  const days = new Map<string, typeof showings>();
  for (const s of showings) {
    const k = s.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  const canEdit = can(ctx.permissions, "leasing", "edit");
  return (
    <>
      <PageHeader eyebrow="Leasing" title="Showings" description="Upcoming tours, including ones prospects book themselves from your listings."
        actions={canEdit ? <ScheduleShowing listings={listings.filter((l) => l.status === "PUBLISHED").map((l) => ({ id: l.id, label: l.title }))} prospects={prospects.map((p) => ({ id: p.id, label: `${p.firstName} ${p.lastName}${p.email ? ` · ${p.email}` : ""}` }))} /> : null} />
      {[...days].map(([day, list]) => (
        <section key={day} aria-labelledby={`d-${day}`} className="mb-4">
          <h2 id={`d-${day}`} className="mb-2 text-sm font-semibold text-muted-foreground">{day}</h2>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
            {list.map((s) => {
              const p = prospects.find((x) => x.id === s.prospectId);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="w-20 font-medium tabular">{s.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}</span>
                  <span className="min-w-0 flex-1"><span className="font-medium">{p ? `${p.firstName} ${p.lastName}` : "Prospect"}</span> · {listings.find((l) => l.id === s.listingId)?.title}<span className="block text-xs text-muted-foreground">{s.durationMin} min{s.source === "SELF_SCHEDULED" ? " · booked online" : ""}{s.agentUserId ? ` · ${users.find((u) => u.userId === s.agentUserId)?.user.name ?? ""}` : ""}{p?.phone ? ` · ${p.phone}` : ""}{s.notes ? ` · ${s.notes}` : ""}</span></span>
                  <StatusBadge status={s.status} />
                  {canEdit && s.status === "SCHEDULED" ? <ShowingStatusButtons id={s.id} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!showings.length ? <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No showings scheduled. Prospects can book from your public listings page.</p> : null}
    </>
  );
}
