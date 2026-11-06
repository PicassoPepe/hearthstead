import { describe, expect, it } from "vitest";
import * as P from "@/server/ledger/postings";
import { allocate, lateFeeFor, mulDivRound, prorateMonthly, type LateFeePolicy, type OpenCharge } from "@/server/ledger/math";
import { addMonths, daysInMonth, parseISODate as d, periodOf, todayIn } from "@/lib/dates";

const dims = { propertyId: "p", unitId: "u", leaseId: "l" };
const sum = (ls: P.Line[], side: "debitCents" | "creditCents", key?: string) =>
  ls.filter((l) => !key || ("key" in l.account && l.account.key === key)).reduce((s, l) => s + l[side], 0);

describe("every posting rule produces a balanced entry", () => {
  const amounts = [1, 99, 150_000, 123_457];
  const cases: [string, (a: number) => P.Line[]][] = [
    ["charge", (a) => P.chargeLines(a, { key: "RENT_INCOME" }, dims)],
    ["payment fully applied", (a) => P.paymentLines(a, a, { key: "UNDEPOSITED_FUNDS" }, dims)],
    ["payment with excess to prepaid", (a) => P.paymentLines(a, Math.floor(a / 2), { key: "UNDEPOSITED_FUNDS" }, dims)],
    ["payment fully prepaid", (a) => P.paymentLines(a, 0, { id: "bank" }, dims)],
    ["credit", (a) => P.creditLines(a, Math.floor(a / 3), { key: "RENT_INCOME" }, dims)],
    ["prepaid application", (a) => P.prepaidApplicationLines(a, dims)],
    ["unapply", (a) => P.unapplyLines(a, dims)],
    ["deposit collected", (a) => P.depositLines(a, { key: "DEPOSIT_CASH" }, dims)],
    ["deposit refund", (a) => P.depositRefundLines(a, { key: "DEPOSIT_CASH" }, dims)],
    ["prepaid refund", (a) => P.prepaidRefundLines(a, { key: "OPERATING_CASH" }, dims)],
    ["returned payment", (a) => P.returnedPaymentLines(a, Math.floor(a / 2), { key: "UNDEPOSITED_FUNDS" }, dims)],
    ["bill", (a) => P.billLines([{ account: { key: "OTHER_INCOME" }, amountCents: a, dims }, { account: { id: "repairs" }, amountCents: 7, dims }])],
    ["bill payment", (a) => P.billPaymentLines(a, { key: "OPERATING_CASH" })],
    ["distribution", (a) => P.distributionLines(a, { key: "OPERATING_CASH" }, dims)],
    ["contribution", (a) => P.contributionLines(a, { key: "OPERATING_CASH" }, dims)],
  ];
  for (const [name, build] of cases) {
    it(name, () => {
      for (const a of amounts) {
        const lines = build(a);
        expect(() => P.assertBalanced(lines)).not.toThrow();
        expect(() => P.assertBalanced(P.reverseLines(lines))).not.toThrow();
      }
    });
  }
});

describe("posting directions follow the accounting rules", () => {
  it("charge: Dr A/R, Cr income", () => {
    const l = P.chargeLines(1000, { key: "RENT_INCOME" }, dims);
    expect(sum(l, "debitCents", "ACCOUNTS_RECEIVABLE")).toBe(1000);
    expect(sum(l, "creditCents", "RENT_INCOME")).toBe(1000);
  });
  it("payment: Dr Undeposited, Cr A/R up to the balance, excess Cr Prepaid", () => {
    const l = P.paymentLines(1500, 1000, { key: "UNDEPOSITED_FUNDS" }, dims);
    expect(sum(l, "debitCents", "UNDEPOSITED_FUNDS")).toBe(1500);
    expect(sum(l, "creditCents", "ACCOUNTS_RECEIVABLE")).toBe(1000);
    expect(sum(l, "creditCents", "PREPAID_RENT")).toBe(500);
  });
  it("deposit: Dr Deposit Cash, Cr Deposits Held", () => {
    const l = P.depositLines(2000, { key: "DEPOSIT_CASH" }, dims);
    expect(sum(l, "debitCents", "DEPOSIT_CASH")).toBe(2000);
    expect(sum(l, "creditCents", "DEPOSITS_HELD")).toBe(2000);
  });
  it("bill: Dr expense, Cr A/P; pay bill: Dr A/P, Cr Bank; distribution: Dr Distributions, Cr Bank", () => {
    expect(sum(P.billLines([{ account: { key: "OTHER_INCOME" }, amountCents: 300, dims }]), "creditCents", "ACCOUNTS_PAYABLE")).toBe(300);
    expect(sum(P.billPaymentLines(300, { key: "OPERATING_CASH" }), "debitCents", "ACCOUNTS_PAYABLE")).toBe(300);
    expect(sum(P.distributionLines(500, { key: "OPERATING_CASH" }, dims), "debitCents", "OWNER_DISTRIBUTIONS")).toBe(500);
  });
  it("returned payment reverses what the payment did", () => {
    const pay = P.paymentLines(1500, 1000, { key: "UNDEPOSITED_FUNDS" }, dims);
    const ret = P.returnedPaymentLines(1500, 1000, { key: "UNDEPOSITED_FUNDS" }, dims);
    for (const key of ["UNDEPOSITED_FUNDS", "ACCOUNTS_RECEIVABLE", "PREPAID_RENT"]) {
      const net = sum(pay, "debitCents", key) - sum(pay, "creditCents", key) + sum(ret, "debitCents", key) - sum(ret, "creditCents", key);
      expect(net, key).toBe(0);
    }
  });
  it("lines carry property/unit/lease dimensions", () => {
    for (const l of P.chargeLines(1, { key: "RENT_INCOME" }, dims)) expect(l).toMatchObject(dims);
  });
});

describe("assertBalanced rejects bad entries", () => {
  const A = { key: "RENT_INCOME" as const };
  it.each([
    ["unbalanced", [{ account: A, debitCents: 100, creditCents: 0 }, { account: A, debitCents: 0, creditCents: 99 }]],
    ["single line", [{ account: A, debitCents: 100, creditCents: 0 }]],
    ["both sides on a line", [{ account: A, debitCents: 100, creditCents: 100 }, { account: A, debitCents: 0, creditCents: 0 }]],
    ["floats", [{ account: A, debitCents: 1.5, creditCents: 0 }, { account: A, debitCents: 0, creditCents: 1.5 }]],
    ["negative", [{ account: A, debitCents: -5, creditCents: 0 }, { account: A, debitCents: 0, creditCents: -5 }]],
    ["zero", [{ account: A, debitCents: 0, creditCents: 0 }, { account: A, debitCents: 0, creditCents: 0 }]],
  ])("%s", (_n, lines) => expect(() => P.assertBalanced(lines as P.Line[])).toThrow(P.UnbalancedEntryError));
  it("builders refuse non-positive amounts", () => {
    expect(() => P.chargeLines(0, A, dims)).toThrow(RangeError);
    expect(() => P.paymentLines(100, 101, A, dims)).toThrow(RangeError);
  });
});

describe("proration (daily rate = monthly / days in month)", () => {
  it("full month is the exact monthly amount", () => {
    expect(prorateMonthly(150_000, d("2026-02-01"), d("2026-01-15"), null)).toEqual({ amountCents: 150_000, days: 28, daysInMonth: 28 });
  });
  it("move-in on the 16th of a 30-day month = 15 days", () => {
    expect(prorateMonthly(150_000, d("2026-11-01"), d("2026-11-16"), null)).toMatchObject({ amountCents: 75_000, days: 15 });
  });
  it("move-out on the 10th of a 31-day month = 10 days, rounded half-up", () => {
    expect(prorateMonthly(100_000, d("2026-10-01"), d("2025-01-01"), d("2026-10-10"))).toMatchObject({ amountCents: 32_258, days: 10, daysInMonth: 31 });
  });
  it("leap February", () => {
    expect(prorateMonthly(290_000, d("2028-02-01"), d("2028-02-15"), null)).toMatchObject({ amountCents: 150_000, days: 15, daysInMonth: 29 });
  });
  it("no overlap = 0", () => {
    expect(prorateMonthly(150_000, d("2026-11-01"), d("2026-12-01"), null).amountCents).toBe(0);
  });
  it("mulDivRound is half-up", () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(5, 1, 2)).toBe(3);
  });
});

describe("payment allocation", () => {
  const c = (id: string, rem: number, due: string, kind = "RENT"): OpenCharge => ({ id, remainingCents: rem, dueDate: d(due), date: d(due), chargeKind: kind });
  const open = [c("oct", 1000, "2026-10-01"), c("fee", 50, "2026-10-08", "LATE_FEE"), c("nov", 1000, "2026-11-01")];
  it("oldest open charge first", () => {
    expect(allocate(1500, open)).toEqual({
      applications: [{ chargeId: "oct", amountCents: 1000 }, { chargeId: "fee", amountCents: 50 }, { chargeId: "nov", amountCents: 450 }],
      appliedCents: 1500,
      remainderCents: 0,
    });
  });
  it("rent first when configured", () => {
    expect(allocate(1500, open, "RENT_FIRST").applications.map((a) => a.chargeId)).toEqual(["oct", "nov"]);
  });
  it("excess beyond the balance is the remainder (→ prepaid)", () => {
    expect(allocate(2500, open)).toMatchObject({ appliedCents: 2050, remainderCents: 450 });
  });
  it("skips fully paid charges and never over-applies", () => {
    const r = allocate(100, [c("paid", 0, "2026-09-01"), c("a", 60, "2026-10-01"), c("b", 60, "2026-11-01")]);
    expect(r.applications).toEqual([{ chargeId: "a", amountCents: 60 }, { chargeId: "b", amountCents: 40 }]);
  });
});

describe("late fees", () => {
  const policy: LateFeePolicy = { enabled: true, graceDays: 5, type: "FLAT", amountCents: 5000, percentBps: 500, maxCents: 15000, dailyAccrual: false, dailyCents: 1000 };
  const due = d("2026-11-01");
  const run = (today: string, over: Partial<{ open: number; already: number; initial: boolean }> = {}, p: Partial<LateFeePolicy> = {}) =>
    lateFeeFor({ ...policy, ...p }, { dueDate: due, today: d(today), openRentCents: over.open ?? 150_000, alreadyAssessedCents: over.already ?? 0, initialAssessed: over.initial ?? false });

  it("nothing during the grace period", () => expect(run("2026-11-06").kind).toBeNull());
  it("flat fee the day after grace", () => expect(run("2026-11-07")).toEqual({ kind: "INITIAL", amountCents: 5000 }));
  it("percent of open rent", () => expect(run("2026-11-07", {}, { type: "PERCENT" })).toEqual({ kind: "INITIAL", amountCents: 7500 }));
  it("nothing when rent is paid", () => expect(run("2026-11-20", { open: 0 }).kind).toBeNull());
  it("nothing when disabled", () => expect(run("2026-11-20", {}, { enabled: false }).kind).toBeNull());
  it("daily accrual after the initial fee, capped at the monthly max", () => {
    expect(run("2026-11-08", { initial: true, already: 5000 }, { dailyAccrual: true })).toEqual({ kind: "DAILY", amountCents: 1000 });
    expect(run("2026-11-20", { initial: true, already: 14_500 }, { dailyAccrual: true })).toEqual({ kind: "DAILY", amountCents: 500 });
    expect(run("2026-11-21", { initial: true, already: 15_000 }, { dailyAccrual: true }).kind).toBeNull();
  });
  it("no daily fee unless enabled", () => expect(run("2026-11-08", { initial: true, already: 5000 }).kind).toBeNull());
  it("initial fee is capped too", () => expect(run("2026-11-07", {}, { maxCents: 3000 })).toEqual({ kind: "INITIAL", amountCents: 3000 }));
});

describe("dates", () => {
  it("addMonths clamps the day", () => {
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2026-11-15"), 2).toISOString().slice(0, 10)).toBe("2027-01-15");
  });
  it("daysInMonth / periodOf", () => {
    expect(daysInMonth(d("2028-02-10"))).toBe(29);
    expect(periodOf(d("2026-11-06"))).toBe("2026-11");
  });
  it("todayIn respects the org timezone", () => {
    const instant = new Date("2026-11-07T03:00:00Z"); // still Nov 6 in Chicago
    expect(todayIn("America/Chicago", instant).toISOString().slice(0, 10)).toBe("2026-11-06");
    expect(todayIn("UTC", instant).toISOString().slice(0, 10)).toBe("2026-11-07");
  });
  it("rejects impossible dates", () => expect(() => d("2026-02-30")).toThrow(RangeError));
});
