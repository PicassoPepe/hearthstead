import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import * as svc from "@/server/rentals/service";
import { runImport } from "@/server/importer/service";
import { addNote, storeAttachment } from "@/server/records/service";
import { UserFacingError } from "@/server/action-result";
import { DEFAULT_CHART } from "@/server/accounting/chart";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let dbA: ScopedDb;
let dbB: ScopedDb;
let opCashA: string;

const wizard = (over: Record<string, unknown> = {}) => ({
  type: "MULTI_FAMILY" as const,
  name: "Test Court",
  address: { addressLine1: "1 Test St", city: "Chicago", state: "IL" as const, postalCode: "60601" },
  units: [{ name: "101", marketRentCents: 150_000 }, { name: "102", beds: 2, bathsTenths: 15, sqft: 900, marketRentCents: 175_000 }],
  owners: [],
  ...over,
});

beforeAll(async () => {
  A = await makeOrg("RA");
  B = await makeOrg("RB");
  dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
  opCashA = (await dbA.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("chart of accounts", () => {
  it("is provisioned for every new org, with bank-account records for bank accounts", async () => {
    expect(await dbA.account.count()).toBe(DEFAULT_CHART.length);
    expect(await dbA.bankAccount.count()).toBe(DEFAULT_CHART.filter((a) => a.isBank).length);
    expect(await dbA.account.findFirst({ where: { systemKey: "ACCOUNTS_RECEIVABLE" } })).toMatchObject({ type: "ASSET", isSystem: true });
  });
});

describe("property wizard", () => {
  it("creates the property, its units and ownerships atomically", async () => {
    const o1 = await svc.createOwner(dbA, { kind: "PERSON", firstName: "Ada", lastName: "Owner" });
    const o2 = await svc.createOwner(dbA, { kind: "COMPANY", companyName: "Owner Co LLC" });
    const { id } = await svc.createPropertyFromWizard(dbA, wizard({
      defaultOperatingAccountId: opCashA,
      owners: [{ ownerId: o1.id, percentBps: 7500 }, { ownerId: o2.id, percentBps: 2500 }],
    }));
    const p = await dbA.property.findFirstOrThrow({ where: { id }, include: { units: true, ownerships: true } });
    expect(p.units.map((u) => u.name).sort()).toEqual(["101", "102"]);
    expect(p.units.find((u) => u.name === "102")).toMatchObject({ beds: 2, bathsTenths: 15, sqft: 900, marketRentCents: 175_000 });
    expect(p.ownerships.reduce((s, o) => s + o.percentBps, 0)).toBe(10_000);
    expect(p.defaultOperatingAccountId).toBe(opCashA);
  });

  it("rejects another org's owner, portfolio or bank account", async () => {
    const bOwner = await svc.createOwner(dbB, { kind: "COMPANY", companyName: "B's owner" });
    const bPortfolio = await svc.savePortfolio(dbB, null, { name: "B portfolio" });
    const bBank = (await dbB.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
    await expect(svc.createPropertyFromWizard(dbA, wizard({ owners: [{ ownerId: bOwner.id, percentBps: 10_000 }] }))).rejects.toThrow(UserFacingError);
    await expect(svc.createPropertyFromWizard(dbA, wizard({ portfolioId: bPortfolio.id }))).rejects.toThrow(UserFacingError);
    await expect(svc.createPropertyFromWizard(dbA, wizard({ defaultOperatingAccountId: bBank }))).rejects.toThrow(UserFacingError);
  });

  it("a single-family property can never get a second unit", async () => {
    const { id } = await svc.createPropertyFromWizard(dbA, wizard({ type: "SINGLE_FAMILY", name: "Lone House", units: [{ name: "Main", marketRentCents: 1 }] }));
    await expect(svc.createUnit(dbA, id, { name: "Back house", marketRentCents: 1 })).rejects.toThrow(/exactly one unit/);
  });
});

describe("units", () => {
  it("names are unique per property and the last unit can be archived", async () => {
    const { id } = await svc.createPropertyFromWizard(dbA, wizard({ name: "Two Flat", units: [{ name: "1", marketRentCents: 0 }] }));
    await expect(svc.createUnit(dbA, id, { name: "1", marketRentCents: 0 })).rejects.toThrow(/already used/);
    const only = await dbA.unit.findFirstOrThrow({ where: { propertyId: id } });
    await svc.archiveUnit(dbA, only.id, true);
    expect(await dbA.unit.count({ where: { propertyId: id } })).toBe(0);
    const second = await svc.createUnit(dbA, id, { name: "2", marketRentCents: 0 });
    await svc.archiveUnit(dbA, second.id, true);
    expect(await dbA.unit.count({ where: { propertyId: id } })).toBe(0);
    await svc.archiveUnit(dbA, second.id, false);
    expect(await dbA.unit.count({ where: { propertyId: id } })).toBe(1);
  });
});

describe("ownership", () => {
  it("must total 100% and can't include an owner twice", async () => {
    const { id } = await svc.createPropertyFromWizard(dbA, wizard({ name: "Split House" }));
    const o = await svc.createOwner(dbA, { kind: "COMPANY", companyName: "Solo LLC" });
    await expect(svc.setOwnerships(dbA, id, [{ ownerId: o.id, percentBps: 9000 }])).rejects.toThrow();
    await expect(svc.setOwnerships(dbA, id, [{ ownerId: o.id, percentBps: 5000 }, { ownerId: o.id, percentBps: 5000 }])).rejects.toThrow();
    await svc.setOwnerships(dbA, id, [{ ownerId: o.id, percentBps: 10_000 }]);
    expect(await dbA.propertyOwnership.count({ where: { propertyId: id } })).toBe(1);
    await expect(svc.archiveOwner(dbA, o.id, true)).rejects.toThrow(/still owns/);
  });
});

describe("member property scope", () => {
  it("filters properties when a scope is set", async () => {
    const all = await dbA.property.findMany({ where: svc.propertyScopeWhere([]) });
    const one = await dbA.property.findMany({ where: svc.propertyScopeWhere([all[0]!.id]) });
    expect(all.length).toBeGreaterThan(1);
    expect(one.map((p) => p.id)).toEqual([all[0]!.id]);
  });
});

describe("importer", () => {
  const rows = [
    { propertyName: "Imported Flats", type: "Apartment", addressLine1: "9 Import Rd", city: "Chicago", state: "il", postalCode: "60607", portfolio: "Imports", unitName: "1A", beds: "1", baths: "1", sqft: "700", marketRent: "$1,200.00" },
    { propertyName: "Imported Flats", type: "Apartment", addressLine1: "9 Import Rd", city: "Chicago", state: "IL", postalCode: "60607", portfolio: "Imports", unitName: "1B", beds: "2", baths: "1.5", sqft: "850", marketRent: "1450" },
    { propertyName: "Imported House", type: "SFR", addressLine1: "10 Import Rd", city: "Chicago", state: "IL", postalCode: "60607", portfolio: "", unitName: "", beds: "3", baths: "2", sqft: "1600", marketRent: "2,300" },
  ];

  it("dry run validates without writing", async () => {
    const before = await dbA.property.count();
    const r = await runImport(dbA, "properties", rows, false);
    expect(r).toMatchObject({ ok: true, issues: [] });
    expect(r.summary).toMatch(/2 new properties, 3 units/);
    expect(await dbA.property.count()).toBe(before);
  });

  it("reports every bad row and writes nothing", async () => {
    const before = await dbA.unit.count();
    const bad = [
      { ...rows[0]!, type: "castle", state: "XX", postalCode: "abc", marketRent: "lots", baths: "1.25" },
      { ...rows[1]!, unitName: "1A" }, // duplicate within the file
    ];
    const r = await runImport(dbA, "properties", bad, true);
    expect(r.ok).toBe(false);
    const fields = r.issues.map((i) => `${i.row}:${i.field}`);
    expect(fields).toEqual(expect.arrayContaining(["2:type", "2:state", "2:postalCode", "2:marketRent", "2:baths", "3:unitName"]));
    expect(await dbA.unit.count()).toBe(before);
  });

  it("commits atomically, creating portfolios, and adds units to existing properties by name", async () => {
    const r = await runImport(dbA, "properties", rows, true);
    expect(r).toMatchObject({ ok: true, created: { properties: 2, units: 3 } });
    const flats = await dbA.property.findFirstOrThrow({ where: { name: "Imported Flats" }, include: { units: true, portfolio: true } });
    expect(flats.type).toBe("MULTI_FAMILY");
    expect(flats.portfolio?.name).toBe("Imports");
    expect(flats.units.find((u) => u.name === "1B")).toMatchObject({ bathsTenths: 15, marketRentCents: 145_000 });
    const house = await dbA.property.findFirstOrThrow({ where: { name: "Imported House" }, include: { units: true } });
    expect(house.units.map((u) => u.name)).toEqual(["Main"]);

    const more = await runImport(dbA, "properties", [{ propertyName: "imported flats", unitName: "2A", marketRent: "1300" }], true);
    expect(more).toMatchObject({ ok: true, created: { properties: 0, units: 1 } });
    const again = await runImport(dbA, "properties", [{ propertyName: "Imported House", unitName: "Garage apt" }], false);
    expect(again.issues.map((i) => i.message).join()).toMatch(/single-family/);
  });

  it("imports owners", async () => {
    const r = await runImport(dbA, "owners", [{ firstName: "Imo", lastName: "Owner", email: "IMO@EXAMPLE.COM" }, { companyName: "Imported Trust" }], true);
    expect(r.ok).toBe(true);
    expect(await dbA.owner.findFirst({ where: { email: "imo@example.com" } })).not.toBeNull();
  });
});

describe("notes & files", () => {
  it("attach only to entities in the same org", async () => {
    const p = await dbA.property.findFirstOrThrow();
    await addNote(dbA, "Property", p.id, "Gate code is 1234");
    await expect(addNote(dbB, "Property", p.id, "sneaky")).rejects.toThrow(/not found/);
    const f = await storeAttachment(dbA, { name: "lease.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 test") }, { type: "Property", id: p.id });
    expect(await dbA.attachment.findFirst({ where: { id: f.id } })).toMatchObject({ name: "lease.pdf", sizeBytes: 13 });
    expect(await dbB.attachment.findFirst({ where: { id: f.id } })).toBeNull();
  });
  it("rejects unsupported and oversized files", async () => {
    await expect(storeAttachment(dbA, { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array([1]) }, null)).rejects.toThrow(/isn't supported/);
    await expect(storeAttachment(dbA, { name: "big.pdf", type: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }, null)).rejects.toThrow(/10 MB/);
  });
});
