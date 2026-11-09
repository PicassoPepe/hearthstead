import type { AppContext } from "@/server/context";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { incomeExpense } from "@/server/reports/engine";

/**
 * Budgets: monthly amounts per income/expense account for a year, company-wide or for one
 * property. "Budget vs actual" compares against accrual actuals from the ledger.
 */
export type Amounts = Record<string, number[]>;

const clean = (a: unknown): Amounts => {
  const out: Amounts = {};
  if (!a || typeof a !== "object") return out;
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const months = Array.from({ length: 12 }, (_, i) => Math.round(Number(v[i] ?? 0)) || 0);
    if (months.some((m) => m < 0 || m > 1e12)) throw new UserFacingError("Budget amounts must be zero or more");
    if (months.some((m) => m)) out[k] = months;
  }
  return out;
};

/** Spread an annual amount over 12 months; cents left over go to the earliest months. */
export function spread(annualCents: number): number[] {
  const base = Math.floor(annualCents / 12);
  const rem = annualCents - base * 12;
  return Array.from({ length: 12 }, (_, i) => base + (i < rem ? 1 : 0));
}

export async function createBudget(ctx: AppContext, v: { name: string; year: number; propertyId: string | null; start: "BLANK" | "LAST_YEAR"; adjustPct?: number }) {
  const db = ctx.db;
  if (!v.name.trim()) throw new UserFacingError("Name the budget", { name: "Required" });
  if (!Number.isInteger(v.year) || v.year < 2000 || v.year > 2100) throw new UserFacingError("Choose a year", { year: "Required" });
  if (v.propertyId && !(await db.property.findFirst({ where: { id: v.propertyId } }))) throw new UserFacingError("Choose a property", { propertyId: "Not found" });
  let amounts: Amounts = {};
  if (v.start === "LAST_YEAR") {
    const y = v.year - 1;
    const actual = await incomeExpense(ctx, { from: `${y}-01-01`, to: `${y}-12-31`, basis: "ACCRUAL", propertyIds: v.propertyId ? [v.propertyId] : null, col: (d) => String(d.getUTCMonth()) });
    const f = 1 + (v.adjustPct ?? 0) / 100;
    for (const [acct, cols] of actual) {
      const months = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((cols.get(String(i)) ?? 0) * f)));
      if (months.some((m) => m)) amounts[acct] = months;
    }
  }
  amounts = clean(amounts);
  const b = await db.budget.create({ data: { organizationId: db.ctx.orgId, name: v.name.trim(), year: v.year, propertyId: v.propertyId, amounts, createdById: db.ctx.userId } });
  await audit(db, { action: "budget.created", entityType: "Budget", entityId: b.id, after: { name: b.name, year: b.year, start: v.start } });
  return b;
}

export async function saveBudgetAmounts(db: ScopedDb, id: string, amounts: unknown, name?: string) {
  const b = await db.budget.findFirst({ where: { id } });
  if (!b) throw new UserFacingError("Budget not found");
  const accts = new Set((await db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true } })).map((a) => a.id));
  const a = clean(amounts);
  if (Object.keys(a).some((k) => !accts.has(k))) throw new UserFacingError("Unknown account in budget");
  await db.budget.update({ where: { id }, data: { amounts: a, ...(name?.trim() ? { name: name.trim() } : {}) } });
  await audit(db, { action: "budget.updated", entityType: "Budget", entityId: id });
}

export type BvaRow = { accountId: string; code: string; name: string; type: "INCOME" | "EXPENSE"; budget: number[]; actual: number[]; budgetYtd: number; actualYtd: number; varianceYtd: number; annual: number };

/** Budget vs actual through `throughMonth` (0-11). Variance is favorable-positive for both types. */
export async function budgetVsActual(ctx: AppContext, id: string, throughMonth: number) {
  const b = await ctx.db.budget.findFirst({ where: { id } });
  if (!b) return null;
  const amounts = clean(b.amounts);
  const accts = await ctx.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] }, deletedAt: null }, orderBy: { code: "asc" } });
  const actual = await incomeExpense(ctx, { from: `${b.year}-01-01`, to: `${b.year}-12-31`, basis: "ACCRUAL", propertyIds: b.propertyId ? [b.propertyId] : (ctx.membership.propertyScope.length ? [...ctx.membership.propertyScope] : null), col: (d) => String(d.getUTCMonth()) });
  const rows: BvaRow[] = [];
  for (const a of accts) {
    const budget = amounts[a.id] ?? Array(12).fill(0);
    const act = Array.from({ length: 12 }, (_, i) => actual.get(a.id)?.get(String(i)) ?? 0);
    if (!budget.some((x) => x) && !act.some((x) => x)) continue;
    const sum = (arr: number[]) => arr.slice(0, throughMonth + 1).reduce((n, x) => n + x, 0);
    const budgetYtd = sum(budget);
    const actualYtd = sum(act);
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type as "INCOME" | "EXPENSE", budget, actual: act, budgetYtd, actualYtd, varianceYtd: a.type === "INCOME" ? actualYtd - budgetYtd : budgetYtd - actualYtd, annual: budget.reduce((n, x) => n + x, 0) });
  }
  const tot = (t: "INCOME" | "EXPENSE", k: "budgetYtd" | "actualYtd" | "annual") => rows.filter((r) => r.type === t).reduce((n, r) => n + r[k], 0);
  return {
    budget: b, rows, accounts: accts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type })),
    totals: {
      income: { budget: tot("INCOME", "budgetYtd"), actual: tot("INCOME", "actualYtd"), annual: tot("INCOME", "annual") },
      expense: { budget: tot("EXPENSE", "budgetYtd"), actual: tot("EXPENSE", "actualYtd"), annual: tot("EXPENSE", "annual") },
    },
  };
}

// ─── Fill a budget from what's already in the account ─────────────────────

export type FillOptions = {
  /** Rent and other monthly charges on current leases. */
  leases?: boolean;
  /** Keep charging after a lease's end date (assume it renews at the same rent). */
  assumeRenew?: boolean;
  /** Repeating bills (Rent & Money → Bills → repeating). */
  bills?: boolean;
  /** Last year's actual income and spending, adjusted by `adjustPct`. */
  lastYear?: boolean;
  adjustPct?: number;
  /** Copy another budget's amounts. */
  copyBudgetId?: string | null;
};
export type FillSource = { key: "leases" | "bills" | "lastYear" | "copy"; label: string; totalCents: number; accounts: number };

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
/** Months (0-11) of `year` overlapping [start, end]. */
export function activeMonths(year: number, start: Date, end: Date | null) {
  return Array.from({ length: 12 }, (_, m) => start <= monthEnd(year, m) && (!end || end >= monthStart(year, m)));
}

/**
 * Suggested monthly amounts for a budget, from the sources picked. Nothing is saved — the editor
 * shows the numbers so the user can check them before pressing Save.
 */
export async function budgetFill(ctx: AppContext, id: string, o: FillOptions) {
  const b = await ctx.db.budget.findFirst({ where: { id } });
  const scope = ctx.membership.propertyScope;
  const inScope = (x: { propertyId: string | null } | null) => x && (!scope.length || (x.propertyId && scope.includes(x.propertyId)));
  if (!b || !inScope(b)) throw new UserFacingError("Budget not found");
  const propIds = b.propertyId ? [b.propertyId] : scope.length ? [...scope] : null;
  const valid = new Set((await ctx.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] }, deletedAt: null }, select: { id: true } })).map((a) => a.id));
  const out: Amounts = {};
  const sources: FillSource[] = [];
  const add = (target: Amounts, acct: string, m: number, cents: number) => {
    if (!valid.has(acct) || !cents) return;
    const row = (target[acct] ??= Array<number>(12).fill(0));
    row[m] = (row[m] ?? 0) + cents;
  };
  const merge = (key: FillSource["key"], label: string, part: Amounts) => {
    let total = 0;
    for (const [acct, months] of Object.entries(part)) {
      for (let m = 0; m < 12; m++) { add(out, acct, m, months[m]!); total += months[m]!; }
    }
    sources.push({ key, label, totalCents: total, accounts: Object.keys(part).length });
  };

  if (o.leases) {
    const part: Amounts = {};
    const charges = await ctx.db.recurringCharge.findMany({
      where: { deletedAt: null, frequency: "MONTHLY", lease: { deletedAt: null, status: { in: ["ACTIVE", "DRAFT"] }, ...(propIds ? { propertyId: { in: propIds } } : {}) } },
      include: { lease: { select: { endDate: true, moveOutDate: true, termType: true } } },
    });
    for (const c of charges) {
      const end = o.assumeRenew ? null : c.endDate ?? c.lease.moveOutDate ?? (c.lease.termType === "FIXED" ? c.lease.endDate : null);
      activeMonths(b.year, c.startDate, end).forEach((on, m) => { if (on) add(part, c.accountId, m, c.amountCents); });
    }
    merge("leases", o.assumeRenew ? "Rent and monthly charges from your leases (assuming they renew)" : "Rent and monthly charges from your leases", part);
  }

  if (o.bills) {
    const part: Amounts = {};
    const bills = await ctx.db.recurringBill.findMany({ where: { deletedAt: null, active: true } });
    for (const rb of bills) {
      const lines = (rb.lines as { accountId: string; amountCents: number; propertyId?: string | null }[]) ?? [];
      const months = activeMonths(b.year, monthStart(b.year, 0) < rb.nextRunDate ? new Date(Date.UTC(rb.nextRunDate.getUTCFullYear(), rb.nextRunDate.getUTCMonth(), 1)) : monthStart(b.year, 0), rb.endDate);
      for (const l of lines) {
        if (propIds && (!l.propertyId || !propIds.includes(l.propertyId))) continue;
        months.forEach((on, m) => { if (on) add(part, l.accountId, m, l.amountCents); });
      }
    }
    merge("bills", "Repeating bills", part);
  }

  if (o.lastYear) {
    const y = b.year - 1;
    const actual = await incomeExpense(ctx, { from: `${y}-01-01`, to: `${y}-12-31`, basis: "ACCRUAL", propertyIds: propIds, col: (d) => String(d.getUTCMonth()) });
    const f = 1 + (o.adjustPct ?? 0) / 100;
    const part: Amounts = {};
    for (const [acct, cols] of actual) for (let m = 0; m < 12; m++) add(part, acct, m, Math.max(0, Math.round((cols.get(String(m)) ?? 0) * f)));
    merge("lastYear", `What actually came in and went out in ${y}${o.adjustPct ? ` (${o.adjustPct > 0 ? "+" : ""}${o.adjustPct}%)` : ""}`, part);
  }

  if (o.copyBudgetId) {
    const other = await ctx.db.budget.findFirst({ where: { id: o.copyBudgetId } });
    if (!other || !inScope(other)) throw new UserFacingError("That budget wasn't found");
    merge("copy", `Copied from “${other.name}”`, clean(other.amounts));
  }

  if (!sources.length) throw new UserFacingError("Pick at least one place to fill in from");
  return { amounts: out, sources };
}
