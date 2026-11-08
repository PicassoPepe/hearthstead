import { KeyRound } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { KeysManager } from "@/components/rentals/keys-manager";
import { orgToday } from "@/server/leasing/queries";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Keys & spaces" };

export default async function KeysPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) return <Forbidden what="keys and spaces" />;
  const sp = await searchParams;
  const scope = ctx.membership.propertyScope;
  const inScope = scope.length ? { id: { in: scope } } : {};
  const [items, properties, leases, today] = await Promise.all([
    ctx.db.keyItem.findMany({ where: scope.length ? { propertyId: { in: scope } } : {}, orderBy: [{ kind: "asc" }, { label: "asc" }] }),
    ctx.db.property.findMany({ where: inScope, orderBy: { name: "asc" }, select: { id: true, name: true, units: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } } } }),
    ctx.db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION", "DRAFT"] }, ...(scope.length ? { propertyId: { in: scope } } : {}) }, include: { units: { include: { unit: { select: { name: true } } } }, tenants: { where: { role: "PRIMARY" }, include: { tenant: true }, take: 1 } } }),
    orgToday(ctx),
  ]);
  const pname = new Map(properties.map((p) => [p.id, p.name]));
  const uname = new Map(properties.flatMap((p) => p.units.map((u) => [u.id, u.name] as const)));
  return (
    <>
      <PageHeader icon={<KeyRound aria-hidden />} eyebrow="Rentals" title="Keys & spaces" description="Keys, fobs, remotes, parking spaces, storage units and mailboxes — who has what. Paid spaces bill through the lease automatically." />
      <KeysManager
        canEdit={can(ctx.permissions, "rentals", "edit")}
        today={toISODate(today)}
        initialProperty={sp.propertyId ?? ""}
        properties={properties.map((p) => ({ id: p.id, name: p.name, units: p.units }))}
        leases={leases.map((l) => {
          const t = l.tenants[0]?.tenant;
          return { id: l.id, propertyId: l.propertyId, label: `${l.units.map((u) => u.unit.name).join(", ")} — ${t ? (t.companyName || `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) : "No tenant"}` };
        })}
        items={items.map((k) => ({ id: k.id, kind: k.kind, label: k.label, propertyId: k.propertyId, property: pname.get(k.propertyId) ?? "", unitId: k.unitId, unit: k.unitId ? uname.get(k.unitId) ?? null : null, status: k.status, leaseId: k.leaseId, holder: k.holderName, assignedAt: k.assignedAt ? toISODate(k.assignedAt) : null, feeCents: k.monthlyFeeCents, billed: Boolean(k.recurringChargeId), notes: k.notes }))}
      />
    </>
  );
}
