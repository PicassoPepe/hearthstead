import type { AppContext } from "@/server/context";
import { can } from "@/server/permissions";
import { toISODate } from "@/lib/dates";

export const CALENDAR_KINDS = ["SHOWING", "MOVE_IN", "MOVE_OUT", "LEASE_END", "INSPECTION", "TASK", "RENEWAL"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_LABEL: Record<CalendarKind, string> = {
  SHOWING: "Showings", MOVE_IN: "Move-ins", MOVE_OUT: "Move-outs", LEASE_END: "Lease ends", INSPECTION: "Inspections", TASK: "Tasks due", RENEWAL: "Renewal deadlines",
};

export type CalendarEvent = { id: string; date: string; time: string | null; kind: CalendarKind; title: string; detail: string | null; href: string };

/**
 * Everything with a date in [from, to] that the user can see: showings, move-ins/outs, lease
 * ends, inspections, tasks due and renewal-offer deadlines. Respects module permissions and the
 * member's property scope.
 */
export async function calendarEvents(ctx: AppContext, from: Date, to: Date, tz: string): Promise<CalendarEvent[]> {
  const scope = ctx.membership.propertyScope;
  const inScope = scope.length ? { propertyId: { in: scope } } : {};
  const range = { gte: from, lte: to };
  const out: CalendarEvent[] = [];
  const P = can(ctx.permissions, "leasing", "view");
  const T = can(ctx.permissions, "tasks", "view");
  const leaseLabel = (l: { property: { name: string }; units: { unit: { name: string } }[] }) => `${l.property.name}${l.units.length ? ` · ${l.units.map((u) => u.unit.name).join(", ")}` : ""}`;
  const leaseInclude = { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } }, tenants: { where: { role: "PRIMARY" as const }, include: { tenant: { select: { firstName: true, lastName: true, companyName: true } } }, take: 1 } };
  const who = (l: { tenants: { tenant: { firstName: string | null; lastName: string | null; companyName: string | null } }[] }) => {
    const t = l.tenants[0]?.tenant;
    return t ? (t.companyName || `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) : null;
  };

  if (P) {
    const [ins, outs, ends, showings, renewals] = await Promise.all([
      ctx.db.lease.findMany({ where: { ...inScope, status: { in: ["ACTIVE", "DRAFT", "EVICTION"] }, OR: [{ moveInDate: range }, { moveInDate: null, startDate: range }] }, include: leaseInclude }),
      ctx.db.lease.findMany({ where: { ...inScope, moveOutDate: range }, include: leaseInclude }),
      ctx.db.lease.findMany({ where: { ...inScope, status: { in: ["ACTIVE", "EVICTION"] }, moveOutDate: null, endDate: range }, include: leaseInclude }),
      ctx.db.showing.findMany({ where: { startsAt: { gte: from, lt: new Date(to.getTime() + 86_400_000) }, status: { not: "CANCELLED" } } }),
      ctx.db.renewalOffer.findMany({ where: { status: { in: ["SENT", "DRAFT"] }, expiresOn: range } }),
    ]);
    const [prospects, listings, renewalLeases] = await Promise.all([
      ctx.db.prospect.findMany({ where: { id: { in: showings.map((s) => s.prospectId) } }, select: { id: true, firstName: true, lastName: true } }),
      ctx.db.listing.findMany({ where: { id: { in: showings.map((s) => s.listingId) } }, select: { id: true, title: true, propertyId: true } }),
      ctx.db.lease.findMany({ where: { id: { in: renewals.map((r) => r.leaseId) } }, include: leaseInclude }),
    ]);
    for (const l of ins) out.push({ id: `in-${l.id}`, date: toISODate(l.moveInDate ?? l.startDate), time: null, kind: "MOVE_IN", title: `Move-in · ${leaseLabel(l)}`, detail: who(l), href: `/app/leasing/${l.id}` });
    for (const l of outs) out.push({ id: `out-${l.id}`, date: toISODate(l.moveOutDate!), time: null, kind: "MOVE_OUT", title: `Move-out · ${leaseLabel(l)}`, detail: who(l), href: `/app/leasing/${l.id}` });
    for (const l of ends) out.push({ id: `end-${l.id}`, date: toISODate(l.endDate!), time: null, kind: "LEASE_END", title: `Lease ends · ${leaseLabel(l)}`, detail: who(l), href: `/app/leasing/${l.id}` });
    for (const s of showings) {
      const listing = listings.find((x) => x.id === s.listingId);
      const p = prospects.find((x) => x.id === s.prospectId);
      if (!listing || (scope.length && !scope.includes(listing.propertyId))) continue;
      out.push({ id: `sh-${s.id}`, date: s.startsAt.toLocaleDateString("en-CA", { timeZone: tz }), time: s.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }), kind: "SHOWING", title: `Showing · ${listing.title}`, detail: p ? `${p.firstName} ${p.lastName}` : null, href: "/app/leasing/showings" });
    }
    for (const r of renewals) {
      const lease = renewalLeases.find((x) => x.id === r.leaseId);
      if (!lease || (scope.length && !scope.includes(lease.propertyId))) continue;
      out.push({ id: `rn-${r.id}`, date: toISODate(r.expiresOn!), time: null, kind: "RENEWAL", title: `Renewal offer expires · ${leaseLabel(lease)}`, detail: who(lease), href: "/app/leasing/renewals" });
    }
  }
  if (T) {
    const tasks = await ctx.db.task.findMany({ where: { ...(scope.length ? { OR: [{ propertyId: { in: scope } }, { propertyId: null }] } : {}), dueDate: range, status: { notIn: ["COMPLETED", "ARCHIVED"] } } });
    const props = new Map((await ctx.db.property.findMany({ where: { id: { in: tasks.map((t) => t.propertyId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    for (const t of tasks) out.push({ id: `t-${t.id}`, date: toISODate(t.dueDate!), time: null, kind: t.type === "INSPECTION" ? "INSPECTION" : "TASK", title: `${t.type === "INSPECTION" ? "Inspection" : `#${t.number}`} · ${t.title}`, detail: (t.propertyId && props.get(t.propertyId)) || null, href: `/app/tasks/${t.id}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}
