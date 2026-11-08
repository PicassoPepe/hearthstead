import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lookupParcel, mapAttributes, mockLookup, parseStreet, setParcelFetcher } from "@/adapters/parcels";
import { COUNTIES, countyByFips } from "@/adapters/parcels/counties";
import { ownersMatch } from "@/server/rentals/land-records";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const square = { type: "Polygon" as const, coordinates: [[[-84.851, 36.829], [-84.849, 36.829], [-84.849, 36.831], [-84.851, 36.831], [-84.851, 36.829]]] };
const q = { addressLine1: "527 W Jefferson St", city: "Louisville", state: "KY", postalCode: "40202" };
const census = (fips: string | null) => ok({ result: { addressMatches: fips === null ? [] : [{ matchedAddress: "527 W JEFFERSON ST, LOUISVILLE, KY, 40202", coordinates: { x: -85.7591, y: 38.2541 }, geographies: { Counties: [{ GEOID: fips, NAME: fips === "21111" ? "Jefferson County" : "Other County" }] } }] } });
/** Kentucky 911 rooftop point for the same address (a few metres from the street centerline). */
const ky911 = ok({ features: [{ attributes: { Lat: 38.25457441, Long: -85.75940809, Post_Code: "40202" } }] });

describe("county attribute mapping", () => {
  it("detects common PVA column names", () => {
    const m = mapAttributes({ PIDN: "123-45-678.00", OWNER: "SMITH JOHN", OWNER2: "SMITH MARY", MAIL_ADDR: "PO BOX 5", MAIL_CITY: "MONTICELLO", MAIL_ST: "KY", MAIL_ZIP: "42633", ACRES: "1.25", DEED_BOOK: "345", DEED_PAGE: "12", LEGAL_DESC: "LOT 4 HILLTOP SUB", ASSESSED: 85000, SALE_DATE: Date.UTC(2019, 4, 3), SALE_PRICE: "$92,500", PROP_CLASS: "RESIDENTIAL" });
    expect(m).toMatchObject({ parcelId: "123-45-678.00", ownerName: "SMITH JOHN & SMITH MARY", ownerMailing: "PO BOX 5, MONTICELLO, KY, 42633", acres: 1.25, deedBook: "345", deedPage: "12", legalDescription: "LOT 4 HILLTOP SUB", assessedValueCents: 8_500_000, lastSaleDate: "2019-05-03", lastSalePriceCents: 9_250_000, landUse: "RESIDENTIAL" });
  });
  it("explicit field mapping wins over detection", () => {
    expect(mapAttributes({ PARCEL: "A", MAPNO: "B" }, { parcelId: "MAPNO" }).parcelId).toBe("B");
  });
});

describe("owner of record vs owners on file", () => {
  it("matches on a shared surname or company word, ignoring LLC/TRUST noise", () => {
    expect(ownersMatch("HARMON GRACE A", ["Grace Harmon"])).toBe(true);
    expect(ownersMatch("OAK TERRACE HOLDINGS LLC", ["Oak Terrace Holdings, LLC"])).toBe(true);
    expect(ownersMatch("OAK TERRACE HOLDINGS LLC", ["Grace Harmon"])).toBe(false);
    expect(ownersMatch(null, ["Grace Harmon"])).toBeNull();
  });
});

describe("lookup chain", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.PARCELS_PROVIDER = "auto"; delete process.env.REGRID_TOKEN; });
  afterEach(() => { process.env = { ...saved }; });

  it("Jefferson County, KY: Census geocoder → Kentucky 911 rooftop point → official LOJIC parcel layer (free)", async () => {
    const calls: string[] = [];
    setParcelFetcher(async (url) => {
      calls.push(url);
      if (url.includes("geocoding.geo.census.gov")) return census("21111");
      if (url.includes("Ky_911_Site_Structure_Address_Points")) return ky911;
      if (url.startsWith("https://gis.lojic.org/") && url.includes("/MapServer/1/query")) return ok({ features: [{ properties: { PARCELID: "014E00010000", PIN: 123 }, geometry: square }] });
      throw new Error(`unexpected ${url}`);
    });
    const r = await lookupParcel(q);
    expect(r).toMatchObject({ source: "county:21111", status: "LOOKED_UP", parcelId: "014E00010000", countyName: "Jefferson County, KY", latitude: 38.25457441 });
    expect(r.geometry?.type).toBe("Polygon");
    expect(calls.find((c) => c.includes("Ky_911"))).toContain("Add_Number%3D527");
    // The parcel is queried at the rooftop point, not the street centerline.
    expect(calls.find((c) => c.includes("lojic") && c.includes("/query?"))).toContain("geometry=-85.75940809%2C38.25457441");
    expect(r.links.some((l) => l.label.includes("Jefferson County PVA"))).toBe(true);
  });

  it("parses street numbers and names for the 911 lookup", () => {
    expect(parseStreet("527 W Jefferson St")).toEqual({ number: 527, name: "JEFFERSON" });
    expect(parseStreet("1632 Jones Mill Road")).toEqual({ number: 1632, name: "JONES MILL" });
    expect(parseStreet("12 O'Hara Dr Apt 4")).toEqual({ number: 12, name: "O''HARA" });
    expect(parseStreet("Main St")).toBeNull();
  });

  it("other counties use Regrid when a token is set, else say so", async () => {
    setParcelFetcher(async (url) => {
      if (url.includes("geocoding")) return census("21231");
      if (url.includes("Ky_911")) return ok({ features: [] });
      if (url.includes("app.regrid.com/api/v2/parcels/point")) return ok({ parcels: { features: [{ properties: { path: "/us/ky/adair/123", fields: { parcelnumb: "R-9", owner: "ROE RICHARD", ll_gisacre: 2.1, parval: 120000, saledate: "2021-03-01", saleprice: 150000 } }, geometry: square }] } });
      throw new Error(`unexpected ${url}`);
    });
    const none = await lookupParcel(q);
    expect(none).toMatchObject({ source: "none", status: "NOT_FOUND" });
    expect(none.message).toMatch(/isn't connected yet/);
    process.env.REGRID_TOKEN = "t";
    const r = await lookupParcel(q);
    expect(r).toMatchObject({ source: "regrid", parcelId: "R-9", ownerName: "ROE RICHARD", acres: 2.1, assessedValueCents: 12_000_000, lastSalePriceCents: 15_000_000 });
  });

  it("unmatched addresses and mock/off modes", async () => {
    setParcelFetcher(async () => census(null));
    expect((await lookupParcel(q)).message).toMatch(/couldn't match/);
    process.env.PARCELS_PROVIDER = "mock";
    const a = await lookupParcel(q);
    expect(a).toEqual(await lookupParcel(q)); // deterministic
    expect(a.countyName).toMatch(/\(sample\)/);
    process.env.PARCELS_PROVIDER = "off";
    expect((await lookupParcel(q)).status).toBe("NOT_FOUND");
  });

  it("sample parcels land in the property's town", () => {
    expect(mockLookup({ addressLine1: "1 State St", city: "Chicago", state: "IL", postalCode: "60601" }).latitude).toBeGreaterThan(41.8);
  });
});

describe("county registry", () => {
  it("every county has a FIPS code, a parcel layer and links", () => {
    expect(COUNTIES.length).toBeGreaterThan(0);
    for (const c of COUNTIES) {
      expect(c.fips).toMatch(/^\d{5}$/);
      expect(Boolean(c.arcgisItemId || c.layerUrl)).toBe(true);
      expect(c.links("1").length).toBeGreaterThan(0);
    }
    expect(countyByFips("21111")?.name).toBe("Jefferson County, KY");
    expect(countyByFips("21231")).toBeNull(); // Wayne County, KY has no public parcel layer — Regrid covers it
  });
});
