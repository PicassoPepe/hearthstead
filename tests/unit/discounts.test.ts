import { describe, expect, it } from "vitest";
import { describeDiscount, discountAmount, inWindow, monthsEnd, needsApproval, normalizeCode, CODE_RE, percentOf } from "@/lib/discounts";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("discount math", () => {
  it("percent rounds to the nearest cent, half away from zero", () => {
    expect(percentOf(155_000, 1000)).toBe(15_500);
    expect(percentOf(12_345, 1000)).toBe(1235); // 1234.5 → 1235
    expect(percentOf(155_000, 3333)).toBe(51_662); // 51661.5 → 51662
    expect(percentOf(99, 5000)).toBe(50); // 49.5 → 50
    expect(percentOf(1, 4900)).toBe(0); // 0.49 → 0
  });
  it("fixed and percent never take a charge below $0", () => {
    expect(discountAmount({ kind: "FIXED", value: 10_000 }, 155_000)).toBe(10_000);
    expect(discountAmount({ kind: "FIXED", value: 200_000 }, 155_000)).toBe(155_000);
    expect(discountAmount({ kind: "FIXED", value: 100_000 }, 155_000, 100_000)).toBe(55_000);
    expect(discountAmount({ kind: "PERCENT", value: 10_000 }, 155_000)).toBe(155_000);
    expect(discountAmount({ kind: "PERCENT", value: 5000 }, 155_000, 100_000)).toBe(55_000);
    expect(discountAmount({ kind: "PERCENT", value: 20_000 }, 1000)).toBe(1000); // >100% is capped
    expect(discountAmount({ kind: "FIXED", value: 500 }, 1000, 1000)).toBe(0);
    expect(discountAmount({ kind: "FIXED", value: -500 }, 1000)).toBe(0);
  });
  it("windows: N months, date ranges and forever", () => {
    expect(monthsEnd(d("2026-11-01"), 3).toISOString().slice(0, 10)).toBe("2027-01-31");
    expect(monthsEnd(d("2026-12-01"), 1).toISOString().slice(0, 10)).toBe("2026-12-31");
    const w = { startDate: d("2026-12-01"), endDate: d("2027-01-31") };
    expect(inWindow(w, d("2026-11-30"))).toBe(false);
    expect(inWindow(w, d("2026-12-01"))).toBe(true);
    expect(inWindow(w, d("2027-01-31"))).toBe(true);
    expect(inWindow(w, d("2027-02-01"))).toBe(false);
    expect(inWindow({ startDate: d("2026-12-01"), endDate: null }, d("2030-01-01"))).toBe(true);
  });
  it("approval thresholds (0 = never)", () => {
    expect(needsApproval({ kind: "FIXED", value: 10_000 }, { overCents: 5000, overPercentBps: 0 })).toBe(true);
    expect(needsApproval({ kind: "FIXED", value: 5000 }, { overCents: 5000, overPercentBps: 0 })).toBe(false);
    expect(needsApproval({ kind: "PERCENT", value: 5000 }, { overCents: 5000, overPercentBps: 0 })).toBe(false);
    expect(needsApproval({ kind: "PERCENT", value: 2600 }, { overCents: 0, overPercentBps: 2500 })).toBe(true);
  });
  it("codes and descriptions", () => {
    expect(normalizeCode(" spring 50 ")).toBe("SPRING50");
    expect(CODE_RE.test("SPRING-50")).toBe(true);
    expect(CODE_RE.test("AB")).toBe(false);
    expect(describeDiscount({ kind: "PERCENT", value: 1250, duration: "MONTHS", months: 3, startDate: d("2026-12-01"), endDate: null, chargeKinds: ["RENT"], target: "CHARGE_KINDS" })).toBe("12.5% off rent for 3 months from 2026-12-01");
    expect(describeDiscount({ kind: "FIXED", value: 2500, duration: "ONCE", months: null, startDate: d("2026-12-01"), endDate: null, chargeKinds: [], target: "SINGLE_CHARGE" })).toBe("$25.00 off one charge");
  });
});
