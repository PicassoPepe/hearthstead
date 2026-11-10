import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyForSomeone } from "@/server/platform-admin/service";
import type { PlatformCtx } from "@/server/platform-admin/service";
import { applyRequiredPasswordChange } from "@/server/auth/must-change";
import { verifyPassword } from "@/server/auth/password";
import { newTotpSecret, totp } from "@/server/platform/totp";
import { admin, app, cleanup } from "./helpers";

const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const secret = newTotpSecret();
let ownerId = "";
let staffId = "";
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

const owner = (): PlatformCtx => ({ userId: ownerId, email: `owner-${tag}@deedwood.test`, name: "Owner", role: "OWNER", ip: "203.0.113.8", userAgent: "vitest" });
const staff = (): PlatformCtx => ({ ...owner(), userId: staffId, email: `staff-${tag}@deedwood.test`, role: "STAFF" });
const code = () => totp(secret);

beforeAll(async () => {
  const o = await admin.user.create({ data: { email: `owner-${tag}@deedwood.test`, name: "Owner", twoFactorEnabled: true, totpSecret: secret } });
  const s = await admin.user.create({ data: { email: `staff-${tag}@deedwood.test`, name: "Staff", twoFactorEnabled: true, totpSecret: secret } });
  ownerId = o.id;
  staffId = s.id;
  await admin.platformAdmin.create({ data: { userId: ownerId, role: "OWNER" } });
  await admin.platformAdmin.create({ data: { userId: staffId, role: "STAFF" } });
});

afterAll(async () => {
  await admin.platformAuditLog.deleteMany({ where: { actorUserId: { in: [ownerId, staffId] } } });
  await admin.emailMessage.deleteMany({ where: { to: { contains: tag } } });
  if (createdOrgIds.length) await cleanup(createdOrgIds, createdUserIds);
  await admin.platformAdmin.deleteMany({ where: { userId: { in: [ownerId, staffId] } } });
  await admin.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("platform owner creates a company for someone", () => {
  const base = { ownerName: "Riley Landlord", companyName: `Beta Homes ${tag}`, reason: "First beta landlord", until: null as string | null, emailWelcome: false, code: "" };

  it("is owner-only and needs a fresh two-factor code", async () => {
    await expect(createCompanyForSomeone(staff(), { ...base, email: `nope-${tag}@deedwood.test`, freeBeta: false, code: code() })).rejects.toThrow(/platform owner/);
    await expect(createCompanyForSomeone(owner(), { ...base, email: `nope-${tag}@deedwood.test`, freeBeta: false, code: "000000" })).rejects.toThrow(/code/);
  });

  it("rejects an email that already has an account", async () => {
    await expect(createCompanyForSomeone(owner(), { ...base, email: `owner-${tag}@deedwood.test`, freeBeta: false, code: code() })).rejects.toThrow(/already exists/);
  });

  it("creates the company, leaves email unconfirmed, and can mark it a free beta", async () => {
    const email = `landlord-${tag}@deedwood.test`;
    const created = await createCompanyForSomeone(owner(), { ...base, email, freeBeta: true, password: "Temp-password-1", code: code() });
    createdOrgIds.push(created.orgId);
    createdUserIds.push(created.userId);
    expect(created.temporaryPassword).toBe("Temp-password-1");
    const user = await admin.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.emailVerified).toBeNull();
    expect(user.mustChangePassword).toBe(true);
    expect(await verifyPassword("Temp-password-1", user.passwordHash)).toBe(true);
    const membership = await admin.membership.findFirst({ where: { userId: user.id, organizationId: created.orgId, deletedAt: null }, include: { role: true } });
    expect(membership?.role.key).toBe("ADMIN");
    const sub = await admin.subscription.findUniqueOrThrow({ where: { orgId: created.orgId } });
    expect(sub.status).toBe("BETA");
    expect(sub.compReason).toBe("First beta landlord");
    const log = await admin.platformAuditLog.findFirst({ where: { actorUserId: ownerId, action: "org.created_by_owner", targetId: created.orgId } });
    expect(log?.reason).toBe("First beta landlord");
    expect(JSON.stringify(log?.after)).not.toContain("Temp-password-1");
    expect(await admin.emailMessage.count({ where: { to: email } })).toBe(0);
  });

  it("generates a password when none is given and can email a sign-in link", async () => {
    const email = `welcome-${tag}@deedwood.test`;
    const created = await createCompanyForSomeone(owner(), { ...base, email, companyName: `Welcome Co ${tag}`, freeBeta: false, emailWelcome: true, code: code() });
    createdOrgIds.push(created.orgId);
    createdUserIds.push(created.userId);
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    expect(await admin.emailMessage.count({ where: { to: email, subject: { contains: "Welcome Co" } } })).toBe(1);
    const user = await admin.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.mustChangePassword).toBe(true);
  });
});

describe("the temporary password has to be replaced", () => {
  it("rejects the same password and then clears the flag", async () => {
    const email = `change-${tag}@deedwood.test`;
    const created = await createCompanyForSomeone(owner(), { ownerName: "Casey Landlord", email, companyName: `Change Co ${tag}`, password: "Temp-password-1", freeBeta: false, reason: "Needs a password change", until: null, emailWelcome: false, code: code() });
    createdOrgIds.push(created.orgId);
    createdUserIds.push(created.userId);
    expect((await admin.user.findUniqueOrThrow({ where: { id: created.userId } })).mustChangePassword).toBe(true);
    await expect(applyRequiredPasswordChange(created.userId, "wrong-password", "A-brand-new-password")).rejects.toThrow(/current password/);
    await expect(applyRequiredPasswordChange(created.userId, "Temp-password-1", "Temp-password-1")).rejects.toThrow(/different/);
    await applyRequiredPasswordChange(created.userId, "Temp-password-1", "A-brand-new-password");
    const user = await admin.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.mustChangePassword).toBe(false);
    expect(await verifyPassword("A-brand-new-password", user.passwordHash)).toBe(true);
  });
});
