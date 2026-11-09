import { PLAN_FEATURES } from "./entitlements";

/**
 * DeedWood's price list (accepted Nov 2026). These are the *starting* values written into the Plan
 * table the first time; after that the owner console (/admin → Plans) is the source of truth.
 * Amounts in cents.
 */
export type PlanPrices = {
  key: string;
  mode: "HOSTED" | "SELF_HOSTED" | "ADDON";
  displayName: string;
  description: string;
  unitMin: number;
  unitMax: number | null;
  monthlyFlatCents?: number | null;
  monthlyPerUnitCents?: number | null;
  monthlyMinCents?: number | null;
  annualFlatCents?: number | null;
  annualPerUnitCents?: number | null;
  annualMinCents?: number | null;
  volumeAboveUnits?: number | null;
  volumeMonthlyCents?: number | null;
  volumeAnnualCents?: number | null;
  addOnAnnualCents?: number | null;
  features: string[];
  smsIncluded: number;
  sortOrder: number;
};

export const DEFAULT_PLANS: PlanPrices[] = [
  { key: "hosted_starter", mode: "HOSTED", displayName: "Starter", description: "Up to 25 units. Everything you need to run your rentals.", unitMin: 1, unitMax: 25, monthlyFlatCents: 4_900, annualFlatCents: 47_000, features: PLAN_FEATURES.STARTER, smsIncluded: 0, sortOrder: 1 },
  { key: "hosted_growth", mode: "HOSTED", displayName: "Growth", description: "26–100 units. Your own website domain, vendor portal, owner reports and 100 texts a month.", unitMin: 26, unitMax: 100, monthlyPerUnitCents: 250, monthlyMinCents: 9_900, annualPerUnitCents: 208, annualMinCents: 99_000, features: PLAN_FEATURES.GROWTH, smsIncluded: 100, sortOrder: 2 },
  { key: "hosted_scale", mode: "HOSTED", displayName: "Scale", description: "101+ units. API, priority support, 500 texts a month, no “Powered by”.", unitMin: 101, unitMax: null, monthlyPerUnitCents: 175, monthlyMinCents: 17_500, annualPerUnitCents: 1_740, annualMinCents: 175_000, volumeAboveUnits: 250, volumeMonthlyCents: 150, volumeAnnualCents: 1_500, features: PLAN_FEATURES.SCALE, smsIncluded: 500, sortOrder: 3 },
  { key: "local_annual", mode: "SELF_HOSTED", displayName: "Local", description: "Runs on your own computer or server. Yearly license with updates and email support.", unitMin: 1, unitMax: null, annualPerUnitCents: 1_500, annualMinCents: 19_900, features: PLAN_FEATURES.LOCAL, smsIncluded: 0, sortOrder: 4 },
  { key: "local_care", mode: "SELF_HOSTED", displayName: "Local + Care", description: "Local, plus priority email, help with upgrades and emergency license re-issue.", unitMin: 1, unitMax: null, annualPerUnitCents: 1_500, annualMinCents: 19_900, addOnAnnualCents: 24_900, features: PLAN_FEATURES.LOCAL_CARE, smsIncluded: 0, sortOrder: 5 },
  { key: "addon_storage_50", mode: "ADDON", displayName: "Extra storage (+50 GB)", description: "More room for photos and documents.", unitMin: 0, unitMax: null, monthlyFlatCents: 500, features: ["storage.plus"], smsIncluded: 0, sortOrder: 10 },
  { key: "addon_custom_domain", mode: "ADDON", displayName: "Custom domain (Starter)", description: "Your website on your own domain. Included on Growth and Scale.", unitMin: 0, unitMax: null, monthlyFlatCents: 500, features: ["site.customDomain"], smsIncluded: 0, sortOrder: 11 },
  { key: "addon_sms_500", mode: "ADDON", displayName: "500 text messages", description: "After your plan's included texts.", unitMin: 0, unitMax: null, monthlyFlatCents: 1_000, features: [], smsIncluded: 500, sortOrder: 12 },
];

export type Interval = "month" | "year";

/**
 * What a company pays for a plan, per billing period:
 * flat price, or max(minimum, per-unit × units) — with Scale's cheaper rate above 250 units.
 */
export function quote(plan: Omit<PlanPrices, "features" | "smsIncluded" | "sortOrder" | "displayName" | "description" | "mode" | "key">, units: number, interval: Interval): number {
  const u = Math.max(0, Math.floor(units));
  const flat = interval === "month" ? plan.monthlyFlatCents : plan.annualFlatCents;
  const per = interval === "month" ? plan.monthlyPerUnitCents : plan.annualPerUnitCents;
  const min = (interval === "month" ? plan.monthlyMinCents : plan.annualMinCents) ?? 0;
  const vol = interval === "month" ? plan.volumeMonthlyCents : plan.volumeAnnualCents;
  let base = 0;
  if (flat != null) base = flat;
  else if (per != null) {
    const above = plan.volumeAboveUnits;
    base = above != null && vol != null && u > above ? above * per + (u - above) * vol : u * per;
    base = Math.max(min, base);
  } else return NaN; // not sold on this interval
  if (interval === "year" && plan.addOnAnnualCents) base += plan.addOnAnnualCents;
  return base;
}

/** The hosted plan that fits a unit count. */
export function hostedPlanFor(units: number) {
  return units <= 25 ? "hosted_starter" : units <= 100 ? "hosted_growth" : "hosted_scale";
}
