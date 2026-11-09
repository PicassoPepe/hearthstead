/**
 * Landlord discounts & concessions — the pure parts (math, windows, labels). Client-safe.
 * Money is integer cents; percentages are basis points (2500 = 25%).
 */
export const DISCOUNT_KINDS = ["PERCENT", "FIXED"] as const;
export const DISCOUNT_DURATIONS = ["ONCE", "MONTHS", "DATE_RANGE", "FOREVER"] as const;
export const DISCOUNT_DELIVERY = ["DIRECT", "CODE"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
export type DiscountDuration = (typeof DISCOUNT_DURATIONS)[number];

/** Charge kinds a discount can target (DEPOSIT and OPENING_BALANCE are never discounted). */
export const DISCOUNTABLE_KINDS: Record<string, string> = {
  RENT: "Rent",
  LATE_FEE: "Late fees",
  NSF_FEE: "Returned-payment fees",
  UTILITY: "Utility bill-backs",
  OTHER: "Other fees & add-ons (pet fee, parking…)",
};
export const NEVER_DISCOUNTED = new Set(["DEPOSIT", "OPENING_BALANCE"]);

export const DEFAULT_DISCOUNT_REASONS = [
  "Move-in special / new lease promotion",
  "Lease renewal incentive",
  "Referral reward",
  "Maintenance or service inconvenience",
  "Amenity outage (water, HVAC, etc.)",
  "Early / on-time payment reward",
  "Military / first responder / senior discount",
  "Hardship or payment plan accommodation",
  "Late fee waiver (goodwill)",
  "Billing error correction",
  "Prorated adjustment",
  "Employee / property staff discount",
  "Owner discretion",
];
export const OTHER_REASON = "Other (specify)";

/** Percent of an amount, rounded to the nearest cent (half away from zero). */
export function percentOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

/**
 * How much comes off one charge. Never more than what's left of the charge after earlier
 * discounts (`alreadyCents`), so a charge can't go below $0.
 */
export function discountAmount(d: { kind: string; value: number }, chargeCents: number, alreadyCents = 0): number {
  const room = Math.max(0, chargeCents - alreadyCents);
  const raw = d.kind === "PERCENT" ? percentOf(chargeCents, Math.min(10_000, Math.max(0, d.value))) : Math.max(0, d.value);
  return Math.min(room, raw);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Last discountable day for "the next N months" starting on `start` (inclusive). */
export function monthsEnd(start: Date, months: number): Date {
  const e = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
  return new Date(e.getTime() - 86_400_000);
}

/** Is a charge dated `date` inside the discount's window? (calendar days, inclusive) */
export function inWindow(d: { startDate: Date; endDate: Date | null }, date: Date): boolean {
  return ymd(date) >= ymd(d.startDate) && (!d.endDate || ymd(date) <= ymd(d.endDate));
}

export function describeDiscount(d: { kind: string; value: number; duration: string; months: number | null; startDate: Date; endDate: Date | null; chargeKinds: string[]; target: string }): string {
  const amt = d.kind === "PERCENT" ? `${(d.value / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% off` : `$${(d.value / 100).toFixed(2)} off`;
  const what = d.target === "SINGLE_CHARGE" ? "one charge" : d.chargeKinds.length ? d.chargeKinds.map((k) => (DISCOUNTABLE_KINDS[k] ?? k).split(" (")[0]!.toLowerCase()).join(", ") : "every charge";
  const when = d.duration === "ONCE" ? "" : d.duration === "MONTHS" ? ` for ${d.months} month${d.months === 1 ? "" : "s"} from ${ymd(d.startDate)}` : d.duration === "DATE_RANGE" ? ` from ${ymd(d.startDate)} to ${d.endDate ? ymd(d.endDate) : "—"}` : ` from ${ymd(d.startDate)}, until stopped`;
  return `${amt} ${what}${when}`;
}

/** Does this need a second person's OK? (a threshold of 0 means never) */
export function needsApproval(d: { kind: string; value: number }, policy: { overCents: number; overPercentBps: number }): boolean {
  if (d.kind === "PERCENT") return policy.overPercentBps > 0 && d.value > policy.overPercentBps;
  return policy.overCents > 0 && d.value > policy.overCents;
}

/** Codes: letters, numbers and dashes; stored upper-case. */
export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");
export const CODE_RE = /^[A-Z0-9-]{4,24}$/;

export const DISCOUNT_STATUS_LABEL: Record<string, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { text: "Active", tone: "success" },
  PENDING_APPROVAL: { text: "Waiting for approval", tone: "warning" },
  REJECTED: { text: "Turned down", tone: "neutral" },
  REVOKED: { text: "Stopped", tone: "neutral" },
};
