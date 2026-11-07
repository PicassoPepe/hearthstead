import type { AppContext } from "@/server/context";
import { incomeExpense, propertyFilter } from "@/server/reports/engine";
import { bankAccounts } from "@/server/accounting/payables";
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth, toISODate } from "@/lib/dates";
import type { WidgetData } from "@/lib/widgets";

/** Compute every dashboard widget from live data, honoring the dashboard's property filter and the member's scope. */
export async function widgetData(ctx: AppContext, filter: { propertyId: string; portfolioId: string }, today: Date): Promise<WidgetData> {
  const ids = await propertyFilter(ctx, filter);
  const pw = ids ? { propertyId: { in: ids } } : {};
  const leaseW = ids ? { lease: { propertyId: { in: ids } } } : {};
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  const [rentCharges, units, occupiedRows, noticeRows, expiring, tasks, bills, arAccts] = await Promise.all([
    ctx.db.leaseTransaction.findMany({ where: { type: "CHARGE", chargeKind: "RENT", voidedAt: null, date: { gte: monthStart, lte: monthEnd }, ...leaseW }, select: { amountCents: true, appliedTo: { select: { amountCents: true } } } }),
    ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null, ...(ids ? { id: { in: ids } } : {}) } } }),
    ctx.db.leaseUnit.findMany({ where: { lease: { status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: today }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: today } }], ...pw } }, select: { unitId: true } }),
    ctx.db.leaseUnit.findMany({ where: { lease: { status: { in: ["ACTIVE", "EVICTION"] }, OR: [{ noticeGivenAt: { not: null } }, { moveOutDate: { gte: today, lte: addDays(today, 60) } }], ...pw } }, select: { unitId: true } }),
    ctx.db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION"] }, endDate: { gte: today, lte: addDays(today, 90) }, ...pw }, orderBy: { endDate: "asc" }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } }),
    ctx.db.task.groupBy({ by: ["status"], where: { status: { notIn: ["ARCHIVED"] }, ...pw }, _count: true }),
    ctx.db.bill.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, ...(ids ? { lines: { some: { propertyId: { in: ids } } } } : {}) }, orderBy: { dueDate: "asc" }, include: { vendor: { select: { name: true } } } }),
    ctx.db.account.findMany({ where: { systemKey: { in: ["ACCOUNTS_RECEIVABLE", "PREPAID_RENT"] } }, select: { id: true } }),
  ]);

  // Aging: open rent-roll balances by days past due (from open charges).
  const charges = await ctx.db.leaseTransaction.findMany({ where: { type: "CHARGE", voidedAt: null, ...leaseW }, select: { amountCents: true, dueDate: true, date: true, appliedTo: { select: { amountCents: true } } } });
  const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const c of charges) {
    const open = c.amountCents - c.appliedTo.reduce((s, a) => s + a.amountCents, 0);
    if (open <= 0) continue;
    const late = diffDays(c.dueDate ?? c.date, today);
    if (late <= 0) aging.current += open;
    else if (late <= 30) aging.d30 += open;
    else if (late <= 60) aging.d60 += open;
    else aging.d90 += open;
  }
  const net = await ctx.db.journalLine.groupBy({ by: ["leaseId"], where: { accountId: { in: arAccts.map((a) => a.id) }, leaseId: { not: null }, ...pw }, _sum: { debitCents: true, creditCents: true } });
  const owing = net.filter((n) => (n._sum.debitCents ?? 0) - (n._sum.creditCents ?? 0) > 0).length;

  // P&L, last 6 months (accrual).
  const from = startOfMonth(addMonths(today, -5));
  const pl = await incomeExpense(ctx, { from: toISODate(from), to: toISODate(today), basis: "ACCRUAL", propertyIds: ids, col: (d) => toISODate(d).slice(0, 7) });
  const accts = await ctx.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } });
  const months = Array.from({ length: 6 }, (_, i) => toISODate(addMonths(from, i)).slice(0, 7));
  const pnl = months.map((m) => {
    let income = 0;
    let expenses = 0;
    for (const a of accts) {
      const v = pl.get(a.id)?.get(m) ?? 0;
      if (a.type === "INCOME") income += v; else expenses += v;
    }
    return { month: m, income, expenses };
  });

  // Cash by bank account (all properties only — bank accounts aren't per-property).
  const banks = await bankAccounts(ctx.db);
  const bal = await ctx.db.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: banks.map((b) => b.id) }, ...pw }, _sum: { debitCents: true, creditCents: true } });

  const due = rentCharges.reduce((s, c) => s + c.amountCents, 0);
  const collected = rentCharges.reduce((s, c) => s + c.appliedTo.reduce((t, a) => t + a.amountCents, 0), 0);
  const occupied = new Set(occupiedRows.map((r) => r.unitId)).size;
  const notice = new Set(noticeRows.map((r) => r.unitId)).size;
  const billsOpen = await Promise.all(bills.map(async (b) => {
    const paid = (await ctx.db.billPayment.aggregate({ where: { billId: b.id, voidedAt: null }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    const credit = (await ctx.db.vendorCredit.aggregate({ where: { appliedToBillId: b.id }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
    return { id: b.id, vendor: b.vendor.name, dueDate: toISODate(b.dueDate), openCents: b.totalCents - paid - credit };
  }));
  const weekOut = toISODate(addDays(today, 7));
  const t = toISODate(today);

  return {
    today: t,
    rent: { dueCents: due, collectedCents: collected },
    aging: { ...aging, tenantsOwing: owing },
    occupancy: { units, occupied, vacant: Math.max(0, units - occupied), notice },
    expiring: {
      d30: expiring.filter((l) => diffDays(today, l.endDate!) <= 30).length,
      d60: expiring.filter((l) => diffDays(today, l.endDate!) <= 60).length,
      d90: expiring.length,
      next: expiring.slice(0, 5).map((l) => ({ id: l.id, label: `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`, endDate: toISODate(l.endDate!) })),
    },
    requests: Object.fromEntries(tasks.map((g) => [g.status, g._count])),
    pnl,
    bills: {
      overdueCents: billsOpen.filter((b) => b.dueDate < t).reduce((s, b) => s + b.openCents, 0),
      weekCents: billsOpen.filter((b) => b.dueDate >= t && b.dueDate <= weekOut).reduce((s, b) => s + b.openCents, 0),
      next: billsOpen.filter((b) => b.dueDate <= weekOut).slice(0, 5),
    },
    cash: banks.map((b) => {
      const s = bal.find((x) => x.accountId === b.id);
      return { id: b.id, name: b.name, cents: (s?._sum.debitCents ?? 0) - (s?._sum.creditCents ?? 0) };
    }),
  };
}
