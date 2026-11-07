import { describe, expect, it } from "vitest";
import { normalizeParams, paramsToQuery, rangePresets, reportDefaults, reportToCsv, REPORT_CATALOG } from "@/lib/reports";
import { sanitizeLayout, WIDGET_IDS, PRESETS } from "@/lib/widgets";

const today = new Date("2026-11-07T00:00:00Z");

describe("report params", () => {
  it("defaults to month-to-date, accrual, no grouping; swaps reversed ranges", () => {
    const p = normalizeParams({}, today);
    expect(p).toMatchObject({ from: "2026-11-01", to: "2026-11-07", asOf: "2026-11-07", basis: "ACCRUAL", groupBy: "none", compare: "none" });
    expect(normalizeParams({ from: "2026-12-01", to: "2026-11-01" }, today).from).toBe("2026-11-01");
    expect(normalizeParams({ basis: "CASH", groupBy: "month", compare: "bogus" }, today)).toMatchObject({ basis: "CASH", groupBy: "month", compare: "none" });
  });
  it("per-report defaults and presets", () => {
    expect(reportDefaults("lease-expirations", today)).toEqual({ from: "2026-11-07", to: "2027-02-05" });
    expect(rangePresets(today).find((r) => r.label === "Last month")).toEqual({ label: "Last month", from: "2026-10-01", to: "2026-10-31" });
    expect(paramsToQuery({ from: "2026-01-01", propertyId: "" })).toBe("from=2026-01-01");
    expect(new Set(REPORT_CATALOG.map((r) => r.key)).size).toBe(12);
  });
  it("CSV quotes text and writes money as decimals", () => {
    const csv = reportToCsv({ title: "T", subtitle: "", highlights: [], columns: [{ key: "a", label: "Account", kind: "text" }, { key: "v", label: "Amount", kind: "money" }], rows: [{ cells: { a: 'Rent, "base"', v: 123456 } }, { depth: 1, cells: { a: "Sub", v: -5 } }] });
    expect(csv).toBe('Account,Amount\n"Rent, ""base""",1234.56\n  Sub,-0.05');
  });
});

describe("dashboard layout", () => {
  it("drops unknown ids and appends new widgets", () => {
    const l = sanitizeLayout({ order: ["pnl", "nope", "rent", "pnl"], hidden: ["cash", "x"] });
    expect(l.order.slice(0, 2)).toEqual(["pnl", "rent"]);
    expect(l.order).toHaveLength(WIDGET_IDS.length);
    expect(l.hidden).toEqual(["cash"]);
    expect(sanitizeLayout(null, PRESETS.BOOKKEEPER!.layout).order[0]).toBe("cash");
  });
});
