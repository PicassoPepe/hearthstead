import { describe, expect, it } from "vitest";
import { allocateCents, centsToInput, formatMoney, parseMoney, sumCents } from "@/lib/money";

describe("parseMoney", () => {
  it.each([
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    ["$1,234.56", 123456],
    [".5", 50],
    ["-3.07", -307],
    ["(45.00)", -4500],
    ["0.10", 10],
    ["0", 0],
  ])("%s → %d cents", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "1.2.3", "--1", "$"])("rejects %j", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("never introduces float error (0.1 + 0.2)", () => {
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(parseMoney("0.3"));
  });
});

describe("formatMoney / centsToInput", () => {
  it("formats cents as USD", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-507)).toBe("-$5.07");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(150000, { showCents: false })).toBe("$1,500");
  });
  it("round-trips through the input format", () => {
    for (const c of [0, 1, 99, 100, 123456, -4500]) expect(parseMoney(centsToInput(c))).toBe(c);
  });
  it("refuses non-integer amounts", () => {
    expect(() => formatMoney(1.5)).toThrow(TypeError);
    expect(() => sumCents([1, 2.5])).toThrow(TypeError);
  });
});

describe("allocateCents", () => {
  it("splits evenly with remainder going to largest fractions", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("always sums exactly to the total", () => {
    const totals = [1, 99, 100_001, 123_457, -10_001];
    const weights = [[1], [3, 7], [850, 1200, 640], [33.3, 33.3, 33.4], [1, 2, 3, 4]];
    for (const t of totals) for (const w of weights) expect(sumCents(allocateCents(t, w))).toBe(t);
  });
  it("splits by square footage", () => {
    expect(allocateCents(250_00, [800, 1200])).toEqual([100_00, 150_00]);
  });
  it("rejects zero weights", () => {
    expect(() => allocateCents(100, [0, 0])).toThrow(RangeError);
  });
});
