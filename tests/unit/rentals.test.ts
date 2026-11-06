import { describe, expect, it } from "vitest";
import {
  formatBaths, formatPercentBps, nextUnitName, ownerDisplayName, ownerSchema, parseBaths, parsePercentToBps, propertyWizardSchema, type PropertyWizardInput,
} from "@/lib/rentals";

const base = (): PropertyWizardInput => ({
  type: "MULTI_FAMILY",
  name: "Maple Court",
  address: { addressLine1: "2250 N Maple Ave", city: "Chicago", state: "IL", postalCode: "60614" },
  units: [{ name: "101", marketRentCents: 150000 }, { name: "102", marketRentCents: 150000 }],
  owners: [],
});
const issues = (v: PropertyWizardInput) => {
  const r = propertyWizardSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("propertyWizardSchema business rules", () => {
  it("accepts a valid multi-family property", () => expect(issues(base())).toEqual([]));
  it("requires at least one unit", () => expect(issues({ ...base(), units: [] }).join()).toMatch(/at least one unit/));
  it("single-family has exactly one unit", () => {
    expect(issues({ ...base(), type: "SINGLE_FAMILY" }).join()).toMatch(/exactly one unit/);
    expect(issues({ ...base(), type: "SINGLE_FAMILY", units: [{ name: "Main", marketRentCents: 1 }] })).toEqual([]);
  });
  it("unit names are unique (case-insensitive)", () => {
    expect(issues({ ...base(), units: [{ name: "1A", marketRentCents: 0 }, { name: "1a", marketRentCents: 0 }] }).join()).toMatch(/units.1.name: Unit names must be unique/);
  });
  it("ownership must total exactly 100% when owners are given", () => {
    expect(issues({ ...base(), owners: [{ ownerId: "a", percentBps: 6000 }, { ownerId: "b", percentBps: 3000 }] }).join()).toMatch(/total 100% \(currently 90%\)/);
    expect(issues({ ...base(), owners: [{ ownerId: "a", percentBps: 6000 }, { ownerId: "b", percentBps: 4000 }] })).toEqual([]);
  });
  it("an owner can't be listed twice", () => {
    expect(issues({ ...base(), owners: [{ ownerId: "a", percentBps: 5000 }, { ownerId: "a", percentBps: 5000 }] }).join()).toMatch(/added once/);
  });
  it("validates address fields", () => {
    const v = base();
    v.address = { addressLine1: "", city: "", state: "ZZ" as never, postalCode: "123" };
    const out = issues(v).join("\n");
    for (const f of ["addressLine1", "city", "state", "postalCode"]) expect(out).toContain(`address.${f}`);
  });
  it("rent can't be negative or fractional", () => {
    expect(issues({ ...base(), units: [{ name: "1", marketRentCents: -1 }] }).length).toBeGreaterThan(0);
    expect(issues({ ...base(), units: [{ name: "1", marketRentCents: 10.5 }] }).length).toBeGreaterThan(0);
  });
});

describe("percent & baths helpers (no floats)", () => {
  it.each([["100", 10000], ["62.5", 6250], ["33.33", 3333], ["0.5%", 50], [" 25 % ", 2500]])("parsePercentToBps(%j) = %d", (s, bps) => expect(parsePercentToBps(s)).toBe(bps));
  it.each(["", "abc", "101", "1.234", "-5"])("rejects %j", (s) => expect(parsePercentToBps(s)).toBeNull());
  it("formats bps", () => {
    expect(formatPercentBps(10000)).toBe("100%");
    expect(formatPercentBps(6250)).toBe("62.5%");
    expect(formatPercentBps(3333)).toBe("33.33%");
  });
  it("baths round-trip in tenths", () => {
    expect(parseBaths("1.5")).toBe(15);
    expect(parseBaths("2")).toBe(20);
    expect(parseBaths("1.25")).toBeNull();
    expect(formatBaths(25)).toBe("2.5");
    expect(formatBaths(20)).toBe("2");
    expect(formatBaths(null)).toBe("—");
  });
});

describe("nextUnitName", () => {
  it.each([
    [[], "1"],
    [["101"], "102"],
    [["101", "102"], "103"],
    [["Unit A"], "Unit B"],
    [["Suite 109"], "Suite 110"],
    [["09"], "10"],
    [["Penthouse"], "Penthouse 2"],
    [["101", "103", "102"], "104"],
  ])("%j → %s", (existing, next) => expect(nextUnitName(existing)).toBe(next));
});

describe("owners", () => {
  it("people need first and last names; companies need a company name", () => {
    expect(ownerSchema.safeParse({ kind: "PERSON", firstName: "Dana" }).success).toBe(false);
    expect(ownerSchema.safeParse({ kind: "PERSON", firstName: "Dana", lastName: "W" }).success).toBe(true);
    expect(ownerSchema.safeParse({ kind: "COMPANY" }).success).toBe(false);
    expect(ownerSchema.safeParse({ kind: "COMPANY", companyName: "Bluestem LLC" }).success).toBe(true);
  });
  it("only accepts the last 4 digits of a tax id", () => {
    expect(ownerSchema.safeParse({ kind: "COMPANY", companyName: "X", taxIdLast4: "123456789" }).success).toBe(false);
    expect(ownerSchema.safeParse({ kind: "COMPANY", companyName: "X", taxIdLast4: "6789" }).success).toBe(true);
  });
  it("display names", () => {
    expect(ownerDisplayName({ kind: "PERSON", firstName: "Dana", lastName: "Whitfield" })).toBe("Dana Whitfield");
    expect(ownerDisplayName({ kind: "COMPANY", companyName: "Bluestem Holdings LLC" })).toBe("Bluestem Holdings LLC");
  });
});
