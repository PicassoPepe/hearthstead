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
