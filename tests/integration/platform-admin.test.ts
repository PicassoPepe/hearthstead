import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient } from "@/server/dal";
import * as P from "@/server/platform-admin/service";
import { flagEnabled } from "@/server/platform-admin/flags";
import { audit } from "@/server/audit";
import { totp, newTotpSecret } from "@/server/platform/totp";
import { seedPlatformOwner } from "../../scripts/seed-platform-owner";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let ownerId: string;
let p: P.PlatformCtx;
const secret = newTotpSecret();
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

beforeAll(async () => {
  O = await makeOrg("PLATADM");
  // Start clean: this suite owns the platform-owner rows while it runs.
  await admin.platformAdmin.deleteMany({});
  const owner = await admin.user.create({ data: { email: `owner-${tag}@deedwood.test`, name: "Plat Owner", twoFactorEnabled: true, totpSecret: secret } });
  ownerId = owner.id;
  p = { userId: owner.id, email: owner.email, name: owner.name, role: "OWNER", ip: "203.0.113.5", userAgent: "vitest" };
});
afterAll(async () => {
  await admin.platformAdmin.deleteMany({});
  await admin.impersonation.deleteMany({ where: { adminUserId: ownerId } });
  await admin.platformAuditLog.deleteMany({ where: { actorUserId: ownerId } });
  await admin.featureFlag.deleteMany({ where: { orgId: O.orgId } });
  await cleanup([O.orgId], [O.userId, ownerId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("platform tables are invisible to the app's database role", () => {
  it.each(["PlatformAdmin", "PlatformAuditLog", "Impersonation", "FeatureFlag", "PlatformAnnouncement", "Release", "SecurityEvent"])("deedwood_app cannot read %s", async (table) => {
    await expect(app.$queryRawUnsafe(`SELECT count(*) FROM "${table}"`)).rejects.toThrow(/permission denied/i);
  });
});

describe("platform owner bootstrap", () => {
  it("creates once, is idempotent, refuses a second owner, and rotates only with the break-glass secret", async () => {
    await expect(seedPlatformOwner(admin, { email: undefined })).rejects.toThrow(/PLATFORM_OWNER_EMAIL/);
    const a = await seedPlatformOwner(admin, { email: `boot-${tag}@deedwood.test`, authSecret: "s".repeat(40), baseUrl: "https://app.deedwood.test" });
    expect(a.status).toBe("created");
    expect(a.link).toMatch(/^https:\/\/app\.deedwood\.test\/api\/auth\/callback\/email\?/);
    expect(await admin.verificationToken.count({ where: { identifier: `boot-${tag}@deedwood.test` } })).toBe(1);
    expect((await seedPlatformOwner(admin, { email: `BOOT-${tag}@deedwood.test` })).status).toBe("already");
    await expect(seedPlatformOwner(admin, { email: `second-${tag}@deedwood.test` })).rejects.toThrow(/already exists/);
    await expect(seedPlatformOwner(admin, { email: `second-${tag}@deedwood.test`, rotate: true, breakGlass: "b".repeat(30), secret: "wrong" })).rejects.toThrow(/doesn't match/);
    const r = await seedPlatformOwner(admin, { email: `second-${tag}@deedwood.test`, rotate: true, breakGlass: "b".repeat(30), secret: "b".repeat(30) });
    expect(r.status).toBe("rotated");
    expect(await admin.platformAdmin.count({ where: { role: "OWNER" } })).toBe(1);
    await admin.platformAdmin.deleteMany({});
    await admin.verificationToken.deleteMany({ where: { identifier: { in: [`boot-${tag}@deedwood.test`, `second-${tag}@deedwood.test`] } } });
    await admin.user.deleteMany({ where: { email: { in: [`boot-${tag}@deedwood.test`, `second-${tag}@deedwood.test`] } } });
    await admin.platformAdmin.create({ data: { userId: ownerId } });
  });
});

describe("org admins are not platform admins", () => {
  it("an org ADMIN has no platform access", async () => {
    expect(await P.isPlatformAdmin(O.userId)).toBe(false);
    expect(await P.isPlatformAdmin(ownerId)).toBe(true);
  });
  it("IP allowlist", () => {
    expect(P.ipAllowed("1.2.3.4", "")).toBe(true);
    expect(P.ipAllowed("1.2.3.4", "1.2.3.4, 5.6.7.8")).toBe(true);
    expect(P.ipAllowed("9.9.9.9", "1.2.3.4,5.6.7.8")).toBe(false);
  });
});

describe("view as (impersonation)", () => {
  it("needs a reason and a fresh two-factor code, expires, and marks every change", async () => {
    const code = () => totp(secret);
    await expect(P.startImpersonation(p, { orgId: O.orgId, asUserId: O.userId, reason: "", code: code() })).rejects.toThrow(/reason/);
    await expect(P.startImpersonation(p, { orgId: O.orgId, asUserId: O.userId, reason: "Customer asked for help", code: "000000" })).rejects.toThrow(/code/);
    const now = new Date();
    const imp = await P.startImpersonation(p, { orgId: O.orgId, asUserId: O.userId, reason: "Customer asked for help", code: code(), minutes: 500 }, now);
    expect(imp.expiresAt.getTime() - now.getTime()).toBe(P.MAX_IMPERSONATION_MIN * 60_000);
    expect(await P.activeImpersonation(ownerId, imp.id, now)).not.toBeNull();
    expect(await P.activeImpersonation(O.userId, imp.id, now)).toBeNull(); // someone else's
    expect(await P.activeImpersonation(ownerId, imp.id, new Date(imp.expiresAt.getTime() + 1))).toBeNull(); // expired
    const started = await admin.platformAuditLog.findFirst({ where: { actorUserId: ownerId, action: "impersonation.started" } });
    expect(started?.reason).toBe("Customer asked for help");
    // Changes made while viewing as someone carry the owner's id.
    const db = createScopedClient(app, { orgId: O.orgId, userId: O.userId, impersonatorId: ownerId });
    await audit(db, { action: "test.change", entityType: "Organization", entityId: O.orgId });
    const row = await admin.auditLog.findFirst({ where: { organizationId: O.orgId, action: "test.change" } });
    expect(row).toMatchObject({ actorId: O.userId, impersonatorId: ownerId });
    await P.endImpersonation(ownerId, imp.id);
    expect(await P.activeImpersonation(ownerId, imp.id)).toBeNull();
  });
  it("only active members can be viewed as", async () => {
    await expect(P.startImpersonation(p, { orgId: O.orgId, asUserId: ownerId, reason: "Testing access", code: totp(secret) })).rejects.toThrow(/isn't an active member/);
  });
});

describe("companies, switches, releases", () => {
  it("pause needs step-up and a reason; reinstating clears it", async () => {
    await expect(P.suspendOrg(p, O.orgId, "Unpaid for 60 days", "000000")).rejects.toThrow(/code/);
    await P.suspendOrg(p, O.orgId, "Unpaid for 60 days", totp(secret));
    expect((await admin.organization.findUniqueOrThrow({ where: { id: O.orgId } })).suspendedReason).toBe("Unpaid for 60 days");
    await P.reinstateOrg(p, O.orgId, "Paid in full");
    expect((await admin.organization.findUniqueOrThrow({ where: { id: O.orgId } })).suspendedAt).toBeNull();
  });
  it("a company switch beats the everyone switch, which beats the default", async () => {
    expect(await flagEnabled("ai", O.orgId)).toBe(true);
    await P.setFlag(p, { key: "ai", orgId: O.orgId, enabled: false });
    expect(await flagEnabled("ai", O.orgId)).toBe(false);
    expect(await flagEnabled("ai", null)).toBe(true);
    await P.setFlag(p, { key: "ai", orgId: O.orgId, enabled: null });
    expect(await flagEnabled("ai", O.orgId)).toBe(true);
    await expect(P.setFlag(p, { key: "bad key!", orgId: null, enabled: true })).rejects.toThrow(/letters/);
  });
  it("compares versions and validates releases", async () => {
    expect(P.compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
    expect(P.compareVersions("2.0.0", "2.0.0")).toBe(0);
    await expect(P.publishRelease(p, { version: "v1", channel: "stable", notes: "", minVersion: null })).rejects.toThrow(/1.4.0/);
  });
});
