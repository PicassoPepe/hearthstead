import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateLicenseKeys, verifyLicense } from "@/lib/license";
import { checkIn, extendLicense, issueLicense, revokeLicense } from "@/server/license/control";
import { cleanPlanEdit, ensurePlanCatalog, planQuote } from "@/server/billing/catalog";
import { totp, newTotpSecret } from "@/server/platform/totp";
import type { PlatformCtx } from "@/server/platform-admin/service";
import { admin, app } from "./helpers";

const keys = generateLicenseKeys();
const secret = newTotpSecret();
let p: PlatformCtx;
const email = `lic-${Date.now()}@example.org`;

beforeAll(async () => {
  process.env.LICENSE_SIGNING_PRIVATE_KEY = keys.privateKey;
  process.env.LICENSE_PUBLIC_KEY = keys.publicKey;
  const u = await admin.user.create({ data: { email: `licadmin-${Date.now()}@deedwood.test`, twoFactorEnabled: true, totpSecret: secret } });
  p = { userId: u.id, email: u.email, name: null, role: "OWNER", ip: "203.0.113.9", userAgent: "vitest" };
  await ensurePlanCatalog(admin);
});
afterAll(async () => {
  delete process.env.LICENSE_SIGNING_PRIVATE_KEY;
  delete process.env.LICENSE_PUBLIC_KEY;
  await admin.license.deleteMany({ where: { customerEmail: email } });
  await admin.platformAuditLog.deleteMany({ where: { actorUserId: p.userId } });
  await admin.release.deleteMany({ where: { version: "9.9.9" } });
  await admin.user.delete({ where: { id: p.userId } });
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("plan catalog", () => {
  it("seeds the accepted prices once and keeps owner edits", async () => {
    expect(await ensurePlanCatalog(admin)).toBe(0);
    const growth = await planQuote(admin, "hosted_growth", 80, "month");
    expect(growth.cents).toBe(20_000);
    const before = await admin.plan.findUniqueOrThrow({ where: { key: "addon_storage_50" } });
    await admin.plan.update({ where: { key: "addon_storage_50" }, data: { monthlyFlatCents: 700 } });
    await ensurePlanCatalog(admin);
    expect((await admin.plan.findUniqueOrThrow({ where: { key: "addon_storage_50" } })).monthlyFlatCents).toBe(700);
    await admin.plan.update({ where: { key: "addon_storage_50" }, data: { monthlyFlatCents: before.monthlyFlatCents } });
  });
  it("validates edits", () => {
    expect(() => cleanPlanEdit({ monthlyFlatCents: -5 })).toThrow(/zero or more/);
    expect(() => cleanPlanEdit({ stripePriceMonthId: "abc" })).toThrow(/price_/);
    expect(cleanPlanEdit({ stripePriceMonthId: " price_123 ", displayName: " Starter " })).toEqual({ stripePriceMonthId: "price_123", displayName: "Starter" });
  });
});

describe("licenses (DeedWood's side)", () => {
  it("issues a signed license, renews it through check-in, and turns it off", async () => {
    await expect(issueLicense(p, { customerEmail: email, maxUnits: 30, planKey: "hosted_starter" })).rejects.toThrow(/Local plan/);
    const now = new Date("2026-11-10T00:00:00Z");
    const l = await issueLicense(p, { customerEmail: email, customerName: "Ann", maxUnits: 30 }, now);
    const v = verifyLicense(l.token, keys.publicKey);
    expect(v.ok && v.claims).toMatchObject({ licenseId: l.id, maxUnits: 30, validUntil: "2027-11-10T00:00:00.000Z" });

    await admin.release.create({ data: { version: "9.9.9", notes: "x", minVersion: "9.0.0", createdById: p.userId } });
    const quiet = await checkIn({ token: l.token, version: "1.0.0", units: 12 }, now);
    expect(quiet).toMatchObject({ status: "active", latestVersion: "9.9.9", updateRequired: true });
    expect(quiet.token).toBeUndefined(); // nothing new to hand over
    expect((await admin.license.findUniqueOrThrow({ where: { id: l.id } })).lastCheckInUnits).toBe(12);

    await extendLicense(l.id, 12, now);
    const renewed = await checkIn({ token: l.token, version: "9.9.9" }, now);
    const nv = verifyLicense(renewed.token!, keys.publicKey);
    expect(nv.ok && nv.claims.validUntil).toBe("2028-11-10T00:00:00.000Z");

    await expect(revokeLicense(p, l.id, "Chargeback", "000000")).rejects.toThrow(/code/);
    await revokeLicense(p, l.id, "Chargeback", totp(secret));
    expect(await checkIn({ token: renewed.token!, version: "9.9.9" }, now)).toMatchObject({ status: "revoked", message: "Chargeback" });
    expect((await checkIn({ token: "DW1.bad.bad", version: "1.0.0" }, now)).status).toBe("unknown");
  });
});
