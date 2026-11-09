import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { signLicense, verifyLicense, type LicenseClaims } from "@/lib/license";
import { licensePublicKey } from "@/lib/license-public-key";
import { DEFAULT_PLANS } from "@/lib/pricing";
import { compareVersions } from "@/server/platform-admin/service";
import type { PlatformCtx } from "@/server/platform-admin/service";
import { platformAudit, stepUp } from "@/server/platform-admin/service";

/**
 * DeedWood's side of computer licenses: issue, revoke, and answer the daily check-in.
 * Only runs where LICENSE_SIGNING_PRIVATE_KEY is set (DeedWood's hosted server) — never on a
 * customer's computer.
 */
const privateKey = () => {
  const k = process.env.LICENSE_SIGNING_PRIVATE_KEY?.trim();
  if (!k) throw new UserFacingError("Licensing isn't set up on this server yet. Run `pnpm license:keygen` and add LICENSE_SIGNING_PRIVATE_KEY (see docs/DEPLOY.md).");
  return k;
};

/** Re-issue the signed text when this close to the end (check-ins quietly extend renewed licenses). */
const RENEW_WINDOW_DAYS = 30;

function claimsFor(l: { id: string; customerEmail: string; planKey: string; maxUnits: number; features: string[]; validFrom: Date; validUntil: Date; graceDays: number; releaseChannel: string }, issuedAt = new Date()): LicenseClaims {
  return { licenseId: l.id, customer: l.customerEmail, mode: "SELF_HOSTED", planKey: l.planKey, maxUnits: l.maxUnits, features: [...l.features].sort(), validFrom: l.validFrom.toISOString(), validUntil: l.validUntil.toISOString(), graceDays: l.graceDays, releaseChannel: l.releaseChannel, issuedAt: issuedAt.toISOString() };
}

export async function issueLicense(p: PlatformCtx | null, v: { customerEmail: string; customerName?: string; orgId?: string | null; planKey?: string; maxUnits: number; months?: number; graceDays?: number; features?: string[] }, now = new Date()) {
  const email = v.customerEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserFacingError("Enter the customer's email", { customerEmail: "Required" });
  if (!Number.isInteger(v.maxUnits) || v.maxUnits < 1) throw new UserFacingError("How many units may they manage?", { maxUnits: "At least 1" });
  const planKey = v.planKey ?? "local_annual";
  const plan = (await adminDb.plan.findUnique({ where: { key: planKey } })) ?? DEFAULT_PLANS.find((x) => x.key === planKey);
  if (!plan || plan.mode !== "SELF_HOSTED") throw new UserFacingError("Pick a Local plan", { planKey: "Not a Local plan" });
  const validUntil = new Date(now);
  validUntil.setUTCMonth(validUntil.getUTCMonth() + (v.months ?? 12));
  const key = privateKey();
  const row = await adminDb.license.create({ data: { customerEmail: email, customerName: v.customerName?.trim() || null, orgId: v.orgId ?? null, planKey, maxUnits: v.maxUnits, features: v.features ?? plan.features, validFrom: now, validUntil, graceDays: v.graceDays ?? 14, token: "pending", createdById: p?.userId ?? null } });
  const token = signLicense(claimsFor(row, now), key);
  const l = await adminDb.license.update({ where: { id: row.id }, data: { token } });
  if (p) await platformAudit(p, { action: "license.issued", targetType: "License", targetId: l.id, after: { customerEmail: email, planKey, maxUnits: v.maxUnits, validUntil } });
  return l;
}

/** Extend (renewal paid) — the next check-in hands the install the new signed text. */
export async function extendLicense(id: string, months: number, now = new Date()) {
  const l = await adminDb.license.findUnique({ where: { id } });
  if (!l) throw new UserFacingError("License not found");
  const from = l.validUntil > now ? l.validUntil : now;
  const validUntil = new Date(from);
  validUntil.setUTCMonth(validUntil.getUTCMonth() + months);
  const token = signLicense(claimsFor({ ...l, validUntil }, now), privateKey());
  return adminDb.license.update({ where: { id }, data: { validUntil, token, status: "ACTIVE", revokedAt: null, revokedReason: null } });
}

export async function revokeLicense(p: PlatformCtx, id: string, reason: string, code: string) {
  await stepUp(p, code);
  if (reason.trim().length < 5) throw new UserFacingError("Write a short reason", { reason: "Required" });
  const l = await adminDb.license.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason.trim() } });
  await platformAudit(p, { action: "license.revoked", targetType: "License", targetId: id, reason: reason.trim() });
  return l;
}

export type CheckInReply = { status: "active" | "revoked" | "unknown"; token?: string; latestVersion: string | null; minVersion: string | null; updateRequired: boolean; message?: string };

/** What a computer install sends once a day. Verifies the license it has, then answers. */
export async function checkIn(v: { token: string; version: string; units?: number }, now = new Date()): Promise<CheckInReply> {
  const pub = licensePublicKey();
  const latest = await adminDb.release.findFirst({ where: { channel: "stable" }, orderBy: { publishedAt: "desc" } });
  const versions = { latestVersion: latest?.version ?? null, minVersion: latest?.minVersion ?? null, updateRequired: Boolean(latest?.minVersion && /^\d+\.\d+\.\d+$/.test(v.version) && compareVersions(v.version, latest.minVersion) < 0) };
  if (!pub) return { status: "unknown", ...versions, message: "Licensing isn't set up on the DeedWood server." };
  const r = verifyLicense(v.token, pub);
  if (!r.ok) return { status: "unknown", ...versions, message: "This license wasn't issued by DeedWood." };
  const l = await adminDb.license.findUnique({ where: { id: r.claims.licenseId } });
  if (!l) return { status: "unknown", ...versions };
  await adminDb.license.update({ where: { id: l.id }, data: { lastCheckInAt: now, lastCheckInVersion: v.version.slice(0, 20), lastCheckInUnits: Number.isFinite(v.units) ? v.units : null } });
  if (l.status === "REVOKED") return { status: "revoked", ...versions, message: l.revokedReason ?? "This license was turned off. Contact DeedWood." };
  // Hand over the newest signed text when the stored one differs from what the install has
  // (renewal, more units, new features) or it's close to running out.
  const stale = l.token !== v.token.trim();
  const soon = l.validUntil.getTime() - now.getTime() < RENEW_WINDOW_DAYS * 86_400_000;
  return { status: "active", ...versions, ...(stale || soon ? { token: l.token } : {}) };
}
