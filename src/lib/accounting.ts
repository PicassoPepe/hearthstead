import { allocateCents } from "./money";

/** How to split one amount across several properties/units. */
export type SplitMethod = "EQUAL" | "UNITS" | "SQFT" | "PERCENT";
export type SplitTarget = { id: string; label: string; units?: number; sqft?: number; percent?: number };

/**
 * Split `totalCents` across targets. EQUAL = even shares, UNITS/SQFT = proportional to the
 * target's unit count / square footage, PERCENT = the caller's percentages (must total 100).
 * Uses largest-remainder rounding, so the parts always add up exactly.
 */
export function splitAmount(totalCents: number, targets: SplitTarget[], method: SplitMethod): { id: string; amountCents: number }[] {
  if (!targets.length) return [];
  const weights = targets.map((t) => (method === "EQUAL" ? 1 : method === "UNITS" ? t.units ?? 0 : method === "SQFT" ? t.sqft ?? 0 : t.percent ?? 0));
  if (method === "PERCENT" && Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 1e-9) throw new RangeError("Percentages must add up to 100");
  if (weights.reduce((a, b) => a + b, 0) <= 0) throw new RangeError(method === "SQFT" ? "These properties have no square footage on file" : "Nothing to split by");
  const parts = allocateCents(totalCents, weights);
  return targets.map((t, i) => ({ id: t.id, amountCents: parts[i]! }));
}

export const BILL_STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", OPEN: "Open", PARTIALLY_PAID: "Partially paid", PAID: "Paid", VOID: "Void" };
export const BANK_TXN_STATUS_LABEL: Record<string, string> = { UNMATCHED: "For review", MATCHED: "Matched", CATEGORIZED: "Categorized", IGNORED: "Excluded" };

/** Management fee for a period: percent of the basis (with a minimum), or a flat amount. */
export function managementFee(rule: { type: string; percentBps: number; flatCents: number; minimumCents: number }, basisCents: number): number {
  if (rule.type === "FLAT") return rule.flatCents;
  if (basisCents <= 0) return 0;
  const pct = Math.round((basisCents * rule.percentBps) / 10_000);
  return Math.max(pct, rule.minimumCents);
}
