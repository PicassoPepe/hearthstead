import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { IncomingPayments } from "@/components/payments/incoming-payments";
import { getPaymentsProvider } from "@/adapters/payments";
import { formatMoney } from "@/lib/money";
import { tenantDisplayName } from "@/lib/leasing";

export const metadata = { title: "Incoming payments" };

export default async function IncomingPaymentsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const scope = ctx.membership.propertyScope;
  const intents = await ctx.db.paymentIntent.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { events: { orderBy: { createdAt: "asc" } } } });
  const leases = await ctx.db.lease.findMany({
    where: { id: { in: [...new Set(intents.map((i) => i.leaseId))] }, ...(scope.length ? { propertyId: { in: scope } } : {}) },
    include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } },
  });
  const tenants = await ctx.db.tenant.findMany({ where: { id: { in: intents.map((i) => i.tenantId).filter((x): x is string => !!x) } } });
  const leaseMap = new Map(leases.map((l) => [l.id, l]));
  const rows = intents.filter((i) => leaseMap.has(i.leaseId)).map((i) => {
    const l = leaseMap.get(i.leaseId)!;
    const t = tenants.find((x) => x.id === i.tenantId);
    return {
      id: i.id, date: i.initiatedOn.toISOString().slice(0, 10), tenant: t ? tenantDisplayName(t) : "—", lease: `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`, leaseId: l.id,
      methodType: i.methodType, amountCents: i.amountCents, feeCents: i.feeCents, status: i.status, origin: i.origin, failureReason: i.failureReason,
      expectedPayoutDate: i.expectedPayoutDate?.toISOString().slice(0, 10) ?? null,
      events: i.events.map((e) => ({ status: e.status, at: e.createdAt.toISOString(), note: e.note })),
    };
  });
  const sum = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.amountCents, 0);
  return (
    <>
      <PageHeader eyebrow="Accounting" title="Incoming payments" description="Online payments from the tenant portal and autopay — initiated → processing → succeeded → paid out." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Processing" value={formatMoney(sum(["INITIATED", "PROCESSING"]), { showCents: false })} hint="ACH clearing" />
        <StatCard label="Succeeded, awaiting payout" value={formatMoney(sum(["SUCCEEDED"]), { showCents: false })} />
        <StatCard label="Paid out" value={formatMoney(sum(["PAID_OUT"]), { showCents: false })} />
        <StatCard label="Failed" value={rows.filter((r) => r.status === "FAILED").length} hint="Reversed on the ledger" />
      </div>
      <IncomingPayments rows={rows} mock={getPaymentsProvider().name === "mock"} canSimulate={can(ctx.permissions, "accounting", "edit")} />
    </>
  );
}
