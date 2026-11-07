import { mulDivRound } from "@/server/ledger/math";

/** Client-safe payments helpers. All amounts are integer cents. */
export type MethodType = "CARD" | "ACH";

/** Processor pricing we pass through when the setting is on: card 2.9% + 30¢, ACH 0.8% capped at $5. */
export const FEE_SCHEDULE = {
  CARD: { bps: 290, fixedCents: 30, capCents: null as number | null },
  ACH: { bps: 80, fixedCents: 0, capCents: 500 as number | null },
} as const;

export function convenienceFee(method: MethodType, amountCents: number, passThrough: boolean): number {
  if (!passThrough || amountCents <= 0) return 0;
  const f = FEE_SCHEDULE[method];
  const fee = mulDivRound(amountCents, f.bps, 10_000) + f.fixedCents;
  return f.capCents != null ? Math.min(fee, f.capCents) : fee;
}

export const STATUS_LABEL: Record<string, string> = {
  INITIATED: "Initiated",
  PROCESSING: "Processing",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  PAID_OUT: "Paid out",
  CANCELED: "Canceled",
};

/** Allowed status transitions (anything else is ignored as out-of-order/duplicate). */
export const TRANSITIONS: Record<string, string[]> = {
  INITIATED: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["PAID_OUT", "FAILED"],
  FAILED: [],
  PAID_OUT: [],
  CANCELED: [],
};

/** Luhn check for card numbers (mock processor / client validation). */
export function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function cardBrand(num: string): string {
  const n = num.replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6(011|5)/.test(n)) return "Discover";
  return "Card";
}
