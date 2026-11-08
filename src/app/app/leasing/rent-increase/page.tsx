import { TrendingUp } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { RentIncreaseTool } from "@/components/leasing/rent-increase-tool";
import { orgToday } from "@/server/leasing/queries";
import { addMonths, startOfMonth, toISODate } from "@/lib/dates";

export const metadata = { title: "Rent increases" };

export default async function RentIncreasePage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "edit")) return <Forbidden what="rent increases" />;
  const scope = ctx.membership.propertyScope;
  const today = await orgToday(ctx);
  const leases = await ctx.db.lease.findMany({
    where: { status: { in: ["ACTIVE", "EVICTION"] }, ...(scope.length ? { propertyId: { in: scope } } : {}) },
    include: { property: { select: { id: true, name: true } }, units: { include: { unit: { select: { name: true, marketRentCents: true } } } }, tenants: { where: { role: "PRIMARY" }, include: { tenant: true }, take: 1 }, recurring: { where: { kind: "RENT", deletedAt: null } } },
    orderBy: [{ property: { name: "asc" } }, { startDate: "asc" }],
  });
  const rows = leases.map((l) => {
    const t = l.tenants[0]?.tenant;
    const rent = l.recurring.filter((r) => r.startDate <= today && (!r.endDate || r.endDate >= today)).reduce((n, r) => n + r.amountCents, 0);
    return {
      id: l.id, propertyId: l.property.id, property: l.property.name, units: l.units.map((u) => u.unit.name).join(", "),
      tenant: t ? (t.companyName || `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) : "—",
      rentCents: rent, marketCents: l.units.reduce((n, u) => n + u.unit.marketRentCents, 0), endDate: l.endDate ? toISODate(l.endDate) : null,
    };
  });
  return (
    <>
      <PageHeader icon={<TrendingUp aria-hidden />} eyebrow="Leasing" title="Rent increases" description="Raise (or lower) rent for many leases at once. Choose leases, set the change and effective date, preview, then apply. Already-billed months never change." />
      <RentIncreaseTool rows={rows} defaultEffective={toISODate(startOfMonth(addMonths(today, 2)))} />
    </>
  );
}
