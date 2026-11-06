/**
 * Pure ledger math: proration, payment allocation, late-fee calculation.
 * Integer cents only — rounding is explicit (half-up) and done once.
 */
import { daysInMonth, diffDays, endOfMonth, maxDate, minDate, startOfMonth } from "@/lib/dates";

/** round(a * b / c) half-up, in integer math. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c <= 0) throw new RangeError("Divisor must be positive");
  const n = a * b;
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount too large");
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(n) * 2 + c) / (2 * c));
}

/**
 * Prorate a monthly amount for the days of `month` covered by [from, to] (inclusive).
 * daily rate = monthly / days in month. Returns the full amount when the whole month is covered.
 */
export function prorateMonthly(monthlyCents: number, month: Date, from: Date, to: Date | null): { amountCents: number; days: number; daysInMonth: number } {
  const ms = startOfMonth(month);
  const me = endOfMonth(month);
  const s = maxDate(ms, from);
  const e = to ? minDate(me, to) : me;
  const dim = daysInMonth(month);
  const days = e < s ? 0 : diffDays(s, e) + 1;
  const amountCents = days === dim ? monthlyCents : mulDivRound(monthlyCents, days, dim);
  return { amountCents, days, daysInMonth: dim };
}

export type OpenCharge = { id: string; remainingCents: number; dueDate: Date; date: Date; chargeKind: string | null; createdAt?: Date };
export type ApplicationOrder = "OLDEST_FIRST" | "RENT_FIRST";

/** Sort open charges in the order a payment pays them off. */
export function orderCharges(charges: OpenCharge[], order: ApplicationOrder): OpenCharge[] {
  const byAge = (a: OpenCharge, b: OpenCharge) =>
    a.dueDate.getTime() - b.dueDate.getTime() || a.date.getTime() - b.date.getTime() || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id);
  const sorted = [...charges].sort(byAge);
  if (order === "RENT_FIRST") return [...sorted.filter((c) => c.chargeKind === "RENT"), ...sorted.filter((c) => c.chargeKind !== "RENT")];
  return sorted;
}

/** Apply `amountCents` to open charges in order. Returns applications and the unapplied remainder. */
export function allocate(amountCents: number, charges: OpenCharge[], order: ApplicationOrder = "OLDEST_FIRST") {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new RangeError("Amount must be a non-negative integer");
  let left = amountCents;
  const applications: { chargeId: string; amountCents: number }[] = [];
  for (const c of orderCharges(charges, order)) {
    if (left === 0) break;
    if (c.remainingCents <= 0) continue;
    const take = Math.min(left, c.remainingCents);
    applications.push({ chargeId: c.id, amountCents: take });
    left -= take;
  }
  return { applications, appliedCents: amountCents - left, remainderCents: left };
}

export type LateFeePolicy = {
  enabled: boolean;
  graceDays: number;
  type: "FLAT" | "PERCENT";
  amountCents: number;
  percentBps: number;
  maxCents: number;
  dailyAccrual: boolean;
  dailyCents: number;
};

/**
 * Late fee for one period on `today`.
 *  - Nothing until today > dueDate + graceDays.
 *  - Initial fee: flat, or percent (bps) of the rent still open.
 *  - Optional daily fee for each later day.
 *  - Total for the period never exceeds maxCents (0 = no cap).
 */
export function lateFeeFor(
  policy: LateFeePolicy,
  args: { dueDate: Date; today: Date; openRentCents: number; alreadyAssessedCents: number; initialAssessed: boolean },
): { kind: "INITIAL" | "DAILY" | null; amountCents: number } {
  if (!policy.enabled || args.openRentCents <= 0) return { kind: null, amountCents: 0 };
  const daysLate = diffDays(args.dueDate, args.today);
  if (daysLate <= policy.graceDays) return { kind: null, amountCents: 0 };
  const cap = policy.maxCents > 0 ? policy.maxCents : Number.MAX_SAFE_INTEGER;
  const room = Math.max(0, cap - args.alreadyAssessedCents);
  if (room === 0) return { kind: null, amountCents: 0 };
  if (!args.initialAssessed) {
    const base = policy.type === "FLAT" ? policy.amountCents : mulDivRound(args.openRentCents, policy.percentBps, 10_000);
    return { kind: "INITIAL", amountCents: Math.min(base, room) };
  }
  if (policy.dailyAccrual && policy.dailyCents > 0) return { kind: "DAILY", amountCents: Math.min(policy.dailyCents, room) };
  return { kind: null, amountCents: 0 };
}
