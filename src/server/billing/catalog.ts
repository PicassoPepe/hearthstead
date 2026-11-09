import type { PrismaClient } from "@prisma/client";
import { DEFAULT_PLANS, quote, type Interval } from "@/lib/pricing";
import { UserFacingError } from "@/server/action-result";

/**
 * The plan catalog lives in the Plan table. On every start, any plan that doesn't exist yet is
 * added with the accepted default prices; plans already there are left alone so changes made in
 * /admin → Plans stick.
 */
export async function ensurePlanCatalog(db: Pick<PrismaClient, "plan">) {
  let added = 0;
  for (const p of DEFAULT_PLANS) {
    const exists = await db.plan.findUnique({ where: { key: p.key } });
    if (exists) continue;
    await db.plan.create({ data: { ...p, unitMax: p.unitMax ?? null } });
    added++;
  }
  return added;
}

export async function planQuote(db: Pick<PrismaClient, "plan">, key: string, units: number, interval: Interval) {
  const p = await db.plan.findUnique({ where: { key } });
  if (!p) throw new UserFacingError("Unknown plan");
  return { plan: p, cents: quote(p, units, interval) };
}

const CENTS = ["monthlyFlatCents", "monthlyPerUnitCents", "monthlyMinCents", "annualFlatCents", "annualPerUnitCents", "annualMinCents", "volumeMonthlyCents", "volumeAnnualCents", "addOnAnnualCents"] as const;
export type PlanEdit = Partial<Record<(typeof CENTS)[number], number | null>> & { displayName?: string; description?: string; active?: boolean; published?: boolean; unitMin?: number; unitMax?: number | null; volumeAboveUnits?: number | null; stripePriceMonthId?: string | null; stripePriceYearId?: string | null; stripeProductId?: string | null; smsIncluded?: number; features?: string[] };

/** Validate an edit from /admin → Plans. */
export function cleanPlanEdit(v: PlanEdit): PlanEdit {
  const out: PlanEdit = {};
  if (v.displayName !== undefined) { if (!v.displayName.trim()) throw new UserFacingError("Name the plan", { displayName: "Required" }); out.displayName = v.displayName.trim().slice(0, 60); }
  if (v.description !== undefined) out.description = v.description.trim().slice(0, 300);
  for (const k of CENTS) {
    const x = v[k];
    if (x === undefined) continue;
    if (x !== null && (!Number.isInteger(x) || x < 0 || x > 100_000_000)) throw new UserFacingError("Prices must be zero or more", { [k]: "Invalid" });
    out[k] = x;
  }
  for (const k of ["unitMin", "smsIncluded"] as const) if (v[k] !== undefined) { if (!Number.isInteger(v[k]) || v[k]! < 0) throw new UserFacingError("Use a whole number", { [k]: "Invalid" }); out[k] = v[k]; }
  for (const k of ["unitMax", "volumeAboveUnits"] as const) if (v[k] !== undefined) { if (v[k] !== null && (!Number.isInteger(v[k]) || v[k]! < 1)) throw new UserFacingError("Use a whole number", { [k]: "Invalid" }); out[k] = v[k]; }
  for (const k of ["stripePriceMonthId", "stripePriceYearId", "stripeProductId"] as const) if (v[k] !== undefined) {
    const x = v[k]?.trim() || null;
    if (x && !/^(price|prod)_[A-Za-z0-9]+$/.test(x)) throw new UserFacingError("Stripe IDs look like price_… or prod_…", { [k]: "Invalid" });
    out[k] = x;
  }
  if (v.active !== undefined) out.active = v.active;
  if (v.published !== undefined) out.published = v.published;
  if (v.features !== undefined) out.features = [...new Set(v.features.map((f) => f.trim()).filter(Boolean))];
  return out;
}
