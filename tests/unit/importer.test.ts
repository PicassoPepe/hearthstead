import { describe, expect, it } from "vitest";
import { applyMapping, autoMap, missingRequired, parsePropertyType, templateCsv } from "@/lib/importer";

describe("autoMap", () => {
  it("matches common header spellings", () => {
    const m = autoMap(["Building", "Property Type", "Street Address", "City", "ST", "Zip Code", "Unit #", "Bedrooms", "Bathrooms", "Sq Ft", "Monthly Rent"], "properties");
    expect(m).toMatchObject({
      propertyName: "Building", type: "Property Type", addressLine1: "Street Address", city: "City", state: "ST",
      postalCode: "Zip Code", unitName: "Unit #", beds: "Bedrooms", baths: "Bathrooms", sqft: "Sq Ft", marketRent: "Monthly Rent",
    });
    expect(missingRequired(m, "properties")).toEqual([]);
  });
  it("never maps one column to two fields and reports missing required fields", () => {
    const m = autoMap(["Name", "City"], "properties");
    const used = Object.values(m).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
    expect(missingRequired(m, "properties")).toContain("Street address");
  });
});

describe("applyMapping", () => {
  it("projects, trims and drops blank rows", () => {
    const out = applyMapping([{ A: " Maple ", B: "101" }, { A: "", B: "" }], { propertyName: "A", unitName: "B", beds: null });
    expect(out).toEqual([{ propertyName: "Maple", unitName: "101", beds: "" }]);
  });
});

describe("parsePropertyType", () => {
  it.each([
    ["Multi-family", "MULTI_FAMILY"], ["multi_family", "MULTI_FAMILY"], ["Apartment", "MULTI_FAMILY"], ["SFR", "SINGLE_FAMILY"],
    ["Single family", "SINGLE_FAMILY"], ["Townhouse", "TOWNHOME"], ["warehouse", "COMMERCIAL_INDUSTRIAL"], ["Office", "COMMERCIAL_OFFICE"], ["HOA", "HOA"],
  ])("%s → %s", (input, out) => expect(parsePropertyType(input)).toBe(out));
  it("returns null for unknown types", () => expect(parsePropertyType("castle")).toBeNull());
});

describe("templateCsv", () => {
  it("has a header row and an example row with the same number of columns", () => {
    const [h, ex] = templateCsv("properties").trim().split("\n");
    expect(h!.split(",").length).toBe(12);
    expect(h).toContain("Property name");
    expect(ex).toContain('"$1,250.00"');
  });
});
