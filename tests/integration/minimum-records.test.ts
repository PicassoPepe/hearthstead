import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createLease } from "@/server/leasing/leases";
import { createTenant } from "@/server/leasing/tenants";
import { createPropertyFromWizard, createUnit } from "@/server/rentals/service";
import { billingReadOnly, hostedBillingNotice } from "@/server/billing/subscription";
import { compOrg, type PlatformCtx } from "@/server/platform-admin/service";
import { admin, app, cleanup, makeOrg } from "./helpers";

let org: { orgId: string; userId: string };
let db: ScopedDb;
const orgs: string[] = [];
const users: string[] = [];

beforeAll(async () => {
  org = await makeOrg("minimum");
  orgs.push(org.orgId);
  users.push(org.userId);
  db = createScopedClient(app, { orgId: org.orgId, userId: org.userId });
});
afterAll(async () => {
  await cleanup(orgs, users);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("minimum records, no bank connection", () => {
  it("creates a property, unit, tenant and lease with only the required fields", async () => {
    const named = await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Name Only", address: { addressLine1: "", city: "", state: "", postalCode: "" }, units: [], owners: [] });
    const namedRow = await db.property.findFirstOrThrow({ where: { id: named.id }, include: { units: true } });
    expect(namedRow.name).toBe("Name Only");
    expect(namedRow.addressLine1).toBeNull();
    expect(namedRow.city).toBeNull();
    expect(namedRow.defaultOperatingAccountId).toBeNull();
    expect(namedRow.defaultDepositAccountId).toBeNull();
    expect(namedRow.units).toHaveLength(0);

    const addressed = await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: "", address: { addressLine1: "9 Birch Ln", city: "", state: "", postalCode: "" }, units: [], owners: [] });
    expect((await db.property.findFirstOrThrow({ where: { id: addressed.id } })).name).toBe("9 Birch Ln");

    const { id: unitId } = await createUnit(db, named.id, { name: "A" });
    expect(await db.unit.findFirstOrThrow({ where: { id: unitId } })).toMatchObject({ name: "A", beds: null, bathsTenths: null, sqft: null, marketRentCents: 0 });

    const { id: tenantId } = await createTenant(db, { kind: "PERSON", firstName: "Sam" });
    expect(await db.tenant.findFirstOrThrow({ where: { id: tenantId } })).toMatchObject({ firstName: "Sam", lastName: null, email: null });

    const lease = await createLease(db, {
      propertyId: named.id,
      unitIds: [unitId],
      startDate: "2026-12-01",
      tenants: [{ tenantId, role: "COTENANT" }],
    }, new Date("2026-11-12T00:00:00Z"));
    const saved = await db.lease.findFirstOrThrow({ where: { id: lease.id }, include: { tenants: true, recurring: true, units: true } });
    expect(saved.units.map((u) => u.unitId)).toEqual([unitId]);
    expect(saved.tenants.map((t) => t.role)).toEqual(["PRIMARY"]);
    expect(saved.recurring).toHaveLength(0);
    expect(saved.depositCents).toBe(0);
    expect(saved.endDate).toBeNull();
  });
});

describe("expired complimentary access", () => {
  it("stays fully usable when billing enforcement is on", async () => {
    const adminUser = await admin.user.create({ data: { email: `min-admin-${Date.now()}@deedwood.test`, twoFactorEnabled: true } });
    users.push(adminUser.id);
    const platform: PlatformCtx = { userId: adminUser.id, email: adminUser.email, name: null, role: "OWNER", ip: "203.0.113.9", userAgent: "vitest" };
    await compOrg(platform, org.orgId, { reason: "Wendy beta", until: null });
    await admin.subscription.update({ where: { orgId: org.orgId }, data: { compUntil: new Date(Date.now() - 86_400_000) } });
    process.env.BILLING_ENFORCED = "1";
    try {
      expect(await billingReadOnly(org.orgId)).toBe(false);
      expect(await hostedBillingNotice(org.orgId)).toBeNull();
      await admin.subscription.update({ where: { orgId: org.orgId }, data: { status: "COMPLIMENTARY" } });
      expect(await billingReadOnly(org.orgId)).toBe(false);
      expect(await hostedBillingNotice(org.orgId)).toBeNull();
    } finally {
      delete process.env.BILLING_ENFORCED;
    }
  });
});
