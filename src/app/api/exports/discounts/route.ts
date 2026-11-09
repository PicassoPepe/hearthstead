import { NextResponse } from "next/server";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { audit } from "@/server/audit";
import { tenantDisplayName } from "@/lib/leasing";

const csv = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const money = (c: number) => (c / 100).toFixed(2);

/**
 * Every discount taken off a charge, for the accountant / tax preparer: concessions reduce gross
 * rent. ?year=2026 (default: all years).
 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx || !(can(ctx.permissions, "discounts", "view") || can(ctx.permissions, "accounting", "view"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const year = Number(new URL(req.url).searchParams.get("year")) || null;
  const scope = ctx.membership.propertyScope;
  const apps = await ctx.db.discountApplication.findMany({ where: year ? { createdAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}, include: { discount: true }, orderBy: { createdAt: "asc" } });
  const [charges, credits, leases] = await Promise.all([
    ctx.db.leaseTransaction.findMany({ where: { id: { in: apps.map((a) => a.chargeId) } }, select: { id: true, date: true, memo: true, chargeKind: true } }),
    ctx.db.leaseTransaction.findMany({ where: { id: { in: apps.map((a) => a.creditId) } }, select: { id: true, date: true, voidedAt: true } }),
    ctx.db.lease.findMany({ where: { id: { in: [...new Set(apps.map((a) => a.leaseId))] } }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } }, tenants: { include: { tenant: true } } } }),
  ]);
  const C = new Map(charges.map((c) => [c.id, c]));
  const K = new Map(credits.map((c) => [c.id, c]));
  const L = new Map(leases.map((l) => [l.id, l]));
  const rows = [["Date", "Property", "Unit", "Tenant", "Charge", "Charge type", "Charge amount", "Discount", "Charge after discount", "Reason", "Discount name", "Code", "Voided"]];
  for (const a of apps) {
    const l = L.get(a.leaseId);
    if (!l || (scope.length && !scope.includes(l.propertyId))) continue;
    const c = C.get(a.chargeId);
    const k = K.get(a.creditId);
    rows.push([(k?.date ?? a.createdAt).toISOString().slice(0, 10), l.property.name, l.units.map((u) => u.unit.name).join(" / "), l.tenants.map((t) => tenantDisplayName(t.tenant)).join(" / "), c?.memo ?? "", c?.chargeKind ?? "", money(a.chargeCents), money(a.amountCents), money(a.afterCents), a.discount.reasonText, a.discount.name, a.discount.code ?? "", k?.voidedAt ? "yes" : ""]);
  }
  await audit(ctx.db, { action: "discount.exported", entityType: "Organization", entityId: ctx.org.id, after: { year, rows: rows.length - 1 } });
  return new NextResponse(rows.map((r) => r.map(csv).join(",")).join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="discounts${year ? `-${year}` : ""}.csv"` } });
}
