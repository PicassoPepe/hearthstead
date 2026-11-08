import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { allocateCents } from "@/lib/money";
import { endOfMonth, parseISODate, toISODate, utcDate } from "@/lib/dates";
import { postCharge } from "@/server/leasing/money";

/**
 * Utility billback (RUBS — ratio utility billing). Take a property's utility expense for a month
 * from the ledger (or an amount you enter), keep the owner's share (recovery %), and split the rest
 * across leases occupied that month by square feet, occupants, equally, or 50/50 sqft+occupants.
 * Charges post to the lease ledgers (Utility Reimbursement). One billback per property, month and
 * expense account.
 */
export const METHODS = { SQFT: "By square feet", OCCUPANTS: "By occupants", EQUAL: "Equally per unit", SQFT_OCCUPANTS: "50% square feet / 50% occupants" } as const;
export type Method = keyof typeof METHODS;
export type BillbackInput = { propertyId: string; period: string; expenseAccountId: string; incomeAccountId?: string; method: Method; recoveryPct: number; billCents?: number | null; label: string };
export type BillbackLine = { leaseId: string; label: string; sqft: number; occupants: number; weight: number; amountCents: number };

async function context(db: ScopedDb, v: BillbackInput) {
  if (!/^\d{4}-\d{2}$/.test(v.period)) throw new UserFacingError("Choose a month", { period: "Required" });
  if (!(v.method in METHODS)) throw new UserFacingError("Choose a method", { method: "Required" });
  if (!Number.isInteger(v.recoveryPct) || v.recoveryPct < 1 || v.recoveryPct > 100) throw new UserFacingError("Recovery must be 1–100%", { recoveryPct: "1–100" });
  const property = await db.property.findFirst({ where: { id: v.propertyId } });
  if (!property) throw new UserFacingError("Choose a property", { propertyId: "Required" });
  const from = parseISODate(`${v.period}-01`);
  const to = endOfMonth(from);
  const expense = await db.account.findFirst({ where: { id: v.expenseAccountId, type: "EXPENSE" } });
  if (!expense) throw new UserFacingError("Choose a utility expense account", { expenseAccountId: "Required" });
  // The bill: what the ledger shows for this property/account/month, unless entered.
  const lines = await db.journalLine.aggregate({ where: { accountId: expense.id, propertyId: property.id, journalEntry: { date: { gte: from, lte: to }, source: { not: "YEAR_END_CLOSE" } } }, _sum: { debitCents: true, creditCents: true } });
  const ledgerCents = (lines._sum.debitCents ?? 0) - (lines._sum.creditCents ?? 0);
  const billCents = v.billCents ?? ledgerCents;
  const leases = await db.lease.findMany({
    where: { propertyId: property.id, status: { in: ["ACTIVE", "EVICTION", "ENDED"] }, startDate: { lte: to }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: from } }] },
    include: { units: { include: { unit: { select: { name: true, sqft: true } } } }, tenants: { select: { role: true } } },
  });
  return { property, expense, from, to, ledgerCents, billCents, leases };
}

export async function previewBillback(db: ScopedDb, v: BillbackInput) {
  const c = await context(db, v);
  const recover = Math.round((c.billCents * v.recoveryPct) / 100);
  const base = c.leases.map((l) => ({
    leaseId: l.id,
    label: l.units.map((u) => u.unit.name).join(", "),
    sqft: l.units.reduce((n, u) => n + (u.unit.sqft ?? 0), 0),
    occupants: Math.max(1, l.tenants.filter((t) => t.role !== "COSIGNER").length),
  }));
  const sqftTotal = base.reduce((n, b) => n + b.sqft, 0);
  const occTotal = base.reduce((n, b) => n + b.occupants, 0);
  if ((v.method === "SQFT" || v.method === "SQFT_OCCUPANTS") && base.some((b) => !b.sqft)) throw new UserFacingError("Some units have no square footage — add it, or choose another method", { method: "Missing square feet" });
  const weight = (b: (typeof base)[number]) =>
    v.method === "SQFT" ? b.sqft : v.method === "OCCUPANTS" ? b.occupants : v.method === "EQUAL" ? 1 : 0.5 * (b.sqft / (sqftTotal || 1)) + 0.5 * (b.occupants / (occTotal || 1));
  const weights = base.map(weight);
  const amounts = base.length && recover > 0 ? allocateCents(recover, weights) : base.map(() => 0);
  const lines: BillbackLine[] = base.map((b, i) => ({ ...b, weight: weights[i]!, amountCents: amounts[i]! }));
  const existing = await db.utilityBillback.findFirst({ where: { propertyId: v.propertyId, period: v.period, expenseAccountId: v.expenseAccountId } });
  return { property: c.property.name, expense: `${c.expense.code} · ${c.expense.name}`, ledgerCents: c.ledgerCents, billCents: c.billCents, recoverCents: recover, ownerShareCents: c.billCents - recover, lines, alreadyBilled: Boolean(existing) };
}

export async function postBillback(db: ScopedDb, v: BillbackInput) {
  const p = await previewBillback(db, v);
  if (p.alreadyBilled) throw new UserFacingError("This month's bill was already billed back for this property");
  if (p.billCents <= 0) throw new UserFacingError("There's no utility expense to bill back for that month", { billCents: "Enter the bill amount" });
  if (!p.lines.length) throw new UserFacingError("No leases were occupied that month");
  const income = v.incomeAccountId ? await db.account.findFirst({ where: { id: v.incomeAccountId, type: "INCOME" } }) : await db.account.findFirst({ where: { code: "4600" } }) ?? await db.account.findFirst({ where: { systemKey: "OTHER_INCOME" } });
  if (!income) throw new UserFacingError("Choose an income account", { incomeAccountId: "Required" });
  const [y, m] = v.period.split("-").map(Number) as [number, number];
  const chargeDate = utcDate(y, m, 1) > new Date() ? new Date(toISODate(new Date())) : endOfMonth(utcDate(y, m - 1, 1));
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(utcDate(y, m - 1, 1));
  const posted = await db.tx(async (tx) => {
    const out: (BillbackLine & { transactionId: string | null })[] = [];
    for (const l of p.lines) {
      if (l.amountCents <= 0) { out.push({ ...l, transactionId: null }); continue; }
      const t = await postCharge(tx, { orgId: db.ctx.orgId, userId: db.ctx.userId }, { leaseId: l.leaseId, accountId: income.id, amountCents: l.amountCents, date: chargeDate, dueDate: chargeDate, memo: `${v.label.trim() || "Utilities"} billback — ${monthLabel} (${METHODS[v.method].toLowerCase()})`, chargeKind: "OTHER" });
      out.push({ ...l, transactionId: t.id });
    }
    return tx.utilityBillback.create({ data: { organizationId: db.ctx.orgId, propertyId: v.propertyId, period: v.period, expenseAccountId: v.expenseAccountId, incomeAccountId: income.id, label: v.label.trim() || "Utilities", method: v.method, recoveryPct: v.recoveryPct, billCents: p.billCents, totalCents: p.recoverCents, lines: out as unknown as object, createdById: db.ctx.userId } });
  }, { timeout: 60_000 });
  await audit(db, { action: "billback.posted", entityType: "Property", entityId: v.propertyId, after: { period: v.period, totalCents: p.recoverCents, leases: p.lines.length } });
  return posted;
}
