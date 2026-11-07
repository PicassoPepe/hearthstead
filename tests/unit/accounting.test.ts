import { describe, expect, it } from "vitest";
import * as P from "@/server/ledger/postings";
import { managementFee, splitAmount } from "@/lib/accounting";
import { parseBankCsv, MockBankFeedProvider } from "@/adapters/bank-feed";

const total = (lines: P.Line[], side: "debitCents" | "creditCents") => lines.reduce((s, l) => s + l[side], 0);

describe("phase 6 posting rules", () => {
  it("every builder balances", () => {
    const sets = [
      P.billLines([{ account: { id: "a" }, amountCents: 300, dims: { propertyId: "p1" } }, { account: { id: "a" }, amountCents: 100, dims: { propertyId: "p2" } }]),
      P.billPaymentLines(400, { key: "OPERATING_CASH" }, {}, [{ propertyId: "p1", amountCents: 300 }, { propertyId: "p2", amountCents: 100 }]),
      P.expenseLines([{ account: { id: "e" }, amountCents: 999, dims: {} }], { key: "OPERATING_CASH" }),
      P.vendorCreditLines(50, { id: "e" }, { propertyId: "p1" }),
      P.bankDepositLines([{ amountCents: 10, propertyId: "p1" }, { amountCents: 20, propertyId: "p1" }, { amountCents: 5, propertyId: null }], { key: "OPERATING_CASH" }),
      P.transferLines(77, { key: "OPERATING_CASH" }, { key: "DEPOSIT_CASH" }, {}),
      P.bankCategorizeLines(-1500, { key: "OPERATING_CASH" }, { id: "fees" }, {}),
      P.bankCategorizeLines(250, { key: "OPERATING_CASH" }, { id: "interest" }, {}),
    ];
    for (const l of sets) expect(() => P.assertBalanced(l)).not.toThrow();
  });
  it("bills credit A/P per property; deposits group by property", () => {
    const b = P.billLines([{ account: { id: "a" }, amountCents: 300, dims: { propertyId: "p1" } }, { account: { id: "b" }, amountCents: 200, dims: { propertyId: "p1" } }, { account: { id: "a" }, amountCents: 100, dims: { propertyId: "p2" } }]);
    expect(b.filter((l) => l.creditCents).map((l) => [l.propertyId, l.creditCents])).toEqual([["p1", 500], ["p2", 100]]);
    const d = P.bankDepositLines([{ amountCents: 10, propertyId: "p1" }, { amountCents: 20, propertyId: "p1" }], { key: "OPERATING_CASH" });
    expect(d).toHaveLength(2);
    expect(total(d, "debitCents")).toBe(30);
  });
  it("rejects bad splits", () => {
    expect(() => P.billPaymentLines(400, { key: "OPERATING_CASH" }, {}, [{ propertyId: "p1", amountCents: 300 }])).toThrow(/add up/);
    expect(() => P.bankDepositLines([], { key: "OPERATING_CASH" })).toThrow();
    expect(() => P.bankCategorizeLines(0, { key: "OPERATING_CASH" }, { id: "x" }, {})).toThrow();
  });
});

describe("allocation helpers", () => {
  const t = [{ id: "a", label: "A", units: 1, sqft: 700 }, { id: "b", label: "B", units: 2, sqft: 0 }, { id: "c", label: "C", units: 3, sqft: 300, percent: 0 }];
  it("splits exactly", () => {
    expect(splitAmount(100, t, "EQUAL").map((x) => x.amountCents)).toEqual([34, 33, 33]);
    expect(splitAmount(600, t, "UNITS").map((x) => x.amountCents)).toEqual([100, 200, 300]);
    expect(splitAmount(1001, t, "SQFT").map((x) => x.amountCents)).toEqual([701, 0, 300]);
    expect(() => splitAmount(100, [{ id: "a", label: "A", percent: 60 }, { id: "b", label: "B", percent: 30 }], "PERCENT")).toThrow(/100/);
    expect(splitAmount(100, [{ id: "a", label: "A", percent: 60 }, { id: "b", label: "B", percent: 40 }], "PERCENT").map((x) => x.amountCents)).toEqual([60, 40]);
  });
  it("management fee: percent with minimum, flat, zero basis", () => {
    expect(managementFee({ type: "PERCENT", percentBps: 800, flatCents: 0, minimumCents: 5000 }, 100_000)).toBe(8000);
    expect(managementFee({ type: "PERCENT", percentBps: 800, flatCents: 0, minimumCents: 5000 }, 10_000)).toBe(5000);
    expect(managementFee({ type: "PERCENT", percentBps: 800, flatCents: 0, minimumCents: 5000 }, 0)).toBe(0);
    expect(managementFee({ type: "FLAT", percentBps: 0, flatCents: 2500, minimumCents: 0 }, 0)).toBe(2500);
  });
});

describe("bank feed", () => {
  it("mock mirrors ledger lines with lag and adds monthly fees", async () => {
    const out = await new MockBankFeedProvider().sync({ bankAccountId: "b", externalRef: null, since: "2026-10-01", until: "2026-10-31", ledger: [{ id: "l1", date: "2026-10-05", amountCents: 100, memo: "Rent" }] });
    expect(out.some((t) => t.externalId === "mock-l1" && t.amountCents === 100)).toBe(true);
    expect(out.some((t) => t.description === "MONTHLY SERVICE FEE" && t.amountCents === -1500)).toBe(true);
  });
  it("CSV: parentheses negatives, US dates", () => {
    const { ok } = parseBankCsv([{ "Posted Date": "1/2/26", Memo: "Fee", Amount: "(3.50)" }]);
    expect(ok[0]).toMatchObject({ date: "2026-01-02", amountCents: -350 });
  });
});
