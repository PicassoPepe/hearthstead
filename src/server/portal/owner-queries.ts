import { runReport } from "@/server/reports/engine";
import { normalizeParams } from "@/lib/reports";
import { addMonths, startOfMonth, toISODate } from "@/lib/dates";
import { incomeExpense } from "@/server/reports/engine";
import { ownerReportContext, type OwnerPortalContext } from "./owner-context";

/** Owner home: their share of income/expenses YTD, distributions, occupancy and vacancies. */
export async function ownerHome(o: OwnerPortalContext) {
  const t = toISODate(o.today);
  const ytd = await runReport(ownerReportContext(o), "owner-statement", normalizeParams({ from: `${t.slice(0, 4)}-01-01`, to: t, ownerId: o.owner.id }, o.today), o.today);
  const h = (l: string) => ytd.highlights.find((x) => x.label === l)?.value ?? 0;
  const [units, occupied, dists, monthly] = await Promise.all([
    o.db.unit.findMany({ where: { propertyId: { in: o.propertyIds }, deletedAt: null }, select: { id: true, name: true, marketRentCents: true, propertyId: true } }),
    o.db.leaseUnit.findMany({ where: { lease: { propertyId: { in: o.propertyIds }, status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: o.today }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: o.today } }] } }, select: { unitId: true } }),
    o.db.ownerDistribution.findMany({ where: { ownerId: o.owner.id, propertyId: { in: o.propertyIds } }, orderBy: { date: "desc" }, take: 5 }),
    incomeExpense(ownerReportContext(o), { from: toISODate(startOfMonth(addMonths(o.today, -5))), to: t, basis: "ACCRUAL", propertyIds: o.propertyIds, col: (d, p) => `${toISODate(d).slice(0, 7)}|${p ?? ""}` }),
  ]);
  const occ = new Set(occupied.map((x) => x.unitId));
  const accts = await o.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } });
  const share = new Map(o.properties.map((p) => [p.id, p.percentBps / 10_000]));
  const months = Array.from({ length: 6 }, (_, i) => toISODate(addMonths(startOfMonth(o.today), i - 5)).slice(0, 7));
  const trend = months.map((m) => {
    let income = 0;
    let expenses = 0;
    for (const a of accts) {
      for (const [k, v] of monthly.get(a.id) ?? []) {
        const [mm, p] = k.split("|");
        if (mm !== m) continue;
        const s = Math.round(v * (share.get(p ?? "") ?? 0));
        if (a.type === "INCOME") income += s; else expenses += s;
      }
    }
    return { month: m, income, expenses };
  });
  return {
    income: h("Your income"), expenses: h("Your expenses"), net: h("Your net income"), distributed: h("Distributions paid"),
    units: units.length, occupied: occ.size,
    vacant: units.filter((u) => !occ.has(u.id)).map((u) => ({ id: u.id, name: u.name, property: o.properties.find((p) => p.id === u.propertyId)?.name ?? "", marketRentCents: u.marketRentCents })),
    recentDistributions: dists.map((d) => ({ id: d.id, date: toISODate(d.date), amountCents: d.amountCents, kind: d.kind, property: o.properties.find((p) => p.id === d.propertyId)?.name ?? "" })),
    trend,
  };
}
