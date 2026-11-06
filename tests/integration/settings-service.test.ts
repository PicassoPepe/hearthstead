import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { clearSetting, getSetting, getSettings, setSetting, SettingValidationError } from "@/server/settings/service";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let db: ScopedDb;
// Property/lease tables arrive in later phases; the resolver only needs their ids.
const PROPERTY = "prop_1";
const LEASE = "lease_1";

beforeAll(async () => {
  A = await makeOrg("SA");
  B = await makeOrg("SB");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("getSetting(key, {orgId, propertyId?, leaseId?})", () => {
  it("walks lease → property → org → default against the database", async () => {
    const t = { orgId: A.orgId, propertyId: PROPERTY, leaseId: LEASE };
    expect(await getSetting(db, "lateFees.graceDays", t)).toBe(5); // default

    await setSetting(db, "lateFees.graceDays", "ORG", A.orgId, 3);
    expect(await getSetting(db, "lateFees.graceDays", t)).toBe(3);

    await setSetting(db, "lateFees.graceDays", "PROPERTY", PROPERTY, 7);
    expect(await getSetting(db, "lateFees.graceDays", t)).toBe(7);
    expect(await getSetting(db, "lateFees.graceDays", { orgId: A.orgId, propertyId: "other_property" })).toBe(3);

    await setSetting(db, "lateFees.graceDays", "LEASE", LEASE, 10);
    const r = await getSettings(db, ["lateFees.graceDays"], t);
    expect(r["lateFees.graceDays"]).toMatchObject({ value: 10, source: "LEASE", inherited: { value: 7, source: "PROPERTY" } });

    await clearSetting(db, "lateFees.graceDays", "LEASE", LEASE);
    expect(await getSetting(db, "lateFees.graceDays", t)).toBe(7);
  });

  it("never reads another org's overrides", async () => {
    const dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
    await setSetting(dbB, "applications.feeCents", "ORG", B.orgId, 9900);
    expect(await getSetting(db, "applications.feeCents", { orgId: A.orgId })).toBe(4500);
    expect(await getSetting(dbB, "applications.feeCents", { orgId: B.orgId })).toBe(9900);
  });

  it("validates values and allowed scopes on write", async () => {
    await expect(setSetting(db, "lateFees.graceDays", "ORG", A.orgId, "three")).rejects.toThrow(SettingValidationError);
    await expect(setSetting(db, "applications.feeCents", "LEASE", LEASE, 100)).rejects.toThrow(SettingValidationError);
  });

  it("upserts rather than duplicating", async () => {
    await setSetting(db, "lateFees.amountCents", "ORG", A.orgId, 5000);
    await setSetting(db, "lateFees.amountCents", "ORG", A.orgId, 6000);
    expect(await db.setting.count({ where: { key: "lateFees.amountCents" } })).toBe(1);
    expect(await getSetting(db, "lateFees.amountCents", { orgId: A.orgId })).toBe(6000);
  });
});
