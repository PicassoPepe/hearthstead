import "server-only";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { verifyTotp } from "@/server/platform/totp";

/**
 * DeedWood's own control plane (/admin). Everything here uses the admin database connection —
 * these tables are invisible to the app role — and every change is written to PlatformAuditLog.
 *
 * Access rules:
 *  - the signed-in user has a PlatformAdmin row (org roles never qualify);
 *  - two-factor is on (mandatory; /admin/setup walks through turning it on);
 *  - if PLATFORM_ADMIN_IP_ALLOWLIST is set, the request comes from one of those addresses;
 *  - destructive actions ask for a fresh two-factor code ("step-up").
 */
export type PlatformCtx = { userId: string; email: string; name: string | null; role: string; ip: string; userAgent: string | null };

export class PlatformAccessError extends Error {
  constructor(public reason: "signed_out" | "not_admin" | "mfa_required" | "ip_blocked") {
    super(reason === "mfa_required" ? "Turn on two-factor authentication to use the owner console." : "You don't have access to the owner console.");
  }
}

export function ipAllowed(ip: string, allowlist = process.env.PLATFORM_ADMIN_IP_ALLOWLIST ?? ""): boolean {
  const list = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
  return !list.length || list.includes(ip);
}

export async function isPlatformAdmin(userId: string | null | undefined) {
  return Boolean(userId && (await adminDb.platformAdmin.findUnique({ where: { userId } })));
}

/** Step-up: a current two-factor code (not a recovery code) for destructive actions. */
export async function stepUp(p: PlatformCtx, code: string | undefined) {
  const u = await adminDb.user.findUniqueOrThrow({ where: { id: p.userId } });
  if (!code?.trim() || !u.totpSecret || !verifyTotp(u.totpSecret, code.trim())) throw new UserFacingError("Enter the current 6-digit code from your authenticator app to confirm.", { code: "Invalid code" });
}

export async function platformAudit(p: PlatformCtx, v: { action: string; targetType: string; targetId?: string | null; reason?: string | null; before?: unknown; after?: unknown }) {
  const j = (x: unknown) => (x === undefined || x === null ? undefined : (JSON.parse(JSON.stringify(x)) as object));
  await adminDb.platformAuditLog.create({ data: { actorUserId: p.userId, action: v.action, targetType: v.targetType, targetId: v.targetId ?? null, reason: v.reason ?? null, ip: p.ip === "local" ? null : p.ip, userAgent: p.userAgent?.slice(0, 300) ?? null, before: j(v.before), after: j(v.after) } });
}

const needReason = (reason: string | undefined) => {
  const r = reason?.trim() ?? "";
  if (r.length < 5) throw new UserFacingError("Write a short reason (at least 5 characters). It goes in the audit log.", { reason: "Required" });
  return r.slice(0, 500);
};

// ─── Companies ────────────────────────────────────────────────────────────────

export async function suspendOrg(p: PlatformCtx, orgId: string, reason: string, code: string) {
  await stepUp(p, code);
  const r = needReason(reason);
  const org = await adminDb.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new UserFacingError("Company not found");
  await adminDb.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date(), suspendedReason: r } });
  await platformAudit(p, { action: "org.suspended", targetType: "Organization", targetId: orgId, reason: r });
}

export async function reinstateOrg(p: PlatformCtx, orgId: string, reason: string) {
  const r = needReason(reason);
  await adminDb.organization.update({ where: { id: orgId }, data: { suspendedAt: null, suspendedReason: null } });
  await platformAudit(p, { action: "org.reinstated", targetType: "Organization", targetId: orgId, reason: r });
}

/** Sign every member of a company out of every device. */
export async function forceLogoutOrg(p: PlatformCtx, orgId: string, reason: string) {
  const r = needReason(reason);
  const members = await adminDb.membership.findMany({ where: { organizationId: orgId, deletedAt: null }, select: { userId: true } });
  const res = await adminDb.userSession.updateMany({ where: { userId: { in: members.map((m) => m.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
  await platformAudit(p, { action: "org.force_logout", targetType: "Organization", targetId: orgId, reason: r, after: { sessions: res.count } });
  return res.count;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function resetUserMfa(p: PlatformCtx, userId: string, reason: string, code: string) {
  await stepUp(p, code);
  const r = needReason(reason);
  if (userId === p.userId) throw new UserFacingError("You can't reset your own two-factor here.");
  await adminDb.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, totpSecret: null, recoveryCodeHashes: [] } });
  await adminDb.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await platformAudit(p, { action: "user.mfa_reset", targetType: "User", targetId: userId, reason: r });
}

export async function revokeUserSessions(p: PlatformCtx, userId: string, reason: string) {
  const r = needReason(reason);
  const res = await adminDb.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await platformAudit(p, { action: "user.sessions_revoked", targetType: "User", targetId: userId, reason: r, after: { count: res.count } });
  return res.count;
}

// ─── View as (impersonation) ─────────────────────────────────────────────────

export const IMPERSONATE_COOKIE = "dw_impersonate";
export const MAX_IMPERSONATION_MIN = 60;

export async function startImpersonation(p: PlatformCtx, v: { orgId: string; asUserId: string; reason: string; minutes?: number; code: string }, now = new Date()) {
  await stepUp(p, v.code);
  const r = needReason(v.reason);
  const minutes = Math.min(MAX_IMPERSONATION_MIN, Math.max(5, Math.round(v.minutes ?? 30)));
  const m = await adminDb.membership.findFirst({ where: { organizationId: v.orgId, userId: v.asUserId, status: "ACTIVE", deletedAt: null } });
  if (!m) throw new UserFacingError("That person isn't an active member of this company.");
  await adminDb.impersonation.updateMany({ where: { adminUserId: p.userId, endedAt: null }, data: { endedAt: now } });
  const imp = await adminDb.impersonation.create({ data: { adminUserId: p.userId, orgId: v.orgId, asUserId: v.asUserId, reason: r, startedAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) } });
  await platformAudit(p, { action: "impersonation.started", targetType: "Organization", targetId: v.orgId, reason: r, after: { asUserId: v.asUserId, minutes, impersonationId: imp.id } });
  return imp;
}

/** The active "view as" for this admin, or null (expired / ended / someone else's). */
export async function activeImpersonation(adminUserId: string, id: string | undefined, now = new Date()) {
  if (!id) return null;
  const imp = await adminDb.impersonation.findUnique({ where: { id } });
  if (!imp || imp.adminUserId !== adminUserId || imp.endedAt || imp.expiresAt <= now) return null;
  if (!(await isPlatformAdmin(adminUserId))) return null;
  return imp;
}

export async function endImpersonation(adminUserId: string, id: string) {
  const imp = await adminDb.impersonation.findUnique({ where: { id } });
  if (!imp || imp.adminUserId !== adminUserId || imp.endedAt) return;
  await adminDb.impersonation.update({ where: { id }, data: { endedAt: new Date() } });
  await adminDb.platformAuditLog.create({ data: { actorUserId: adminUserId, action: "impersonation.ended", targetType: "Organization", targetId: imp.orgId } });
}

// ─── Feature flags ────────────────────────────────────────────────────────────

export { FLAGS, flagEnabled } from "./flags";

export async function setFlag(p: PlatformCtx, v: { key: string; orgId: string | null; enabled: boolean | null; note?: string }) {
  const key = v.key.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{1,40}$/.test(key)) throw new UserFacingError("Use letters, numbers, dots or dashes for the flag name.", { key: "Invalid" });
  const existing = await adminDb.featureFlag.findFirst({ where: { key, orgId: v.orgId } });
  if (v.enabled === null) {
    if (existing) await adminDb.featureFlag.delete({ where: { id: existing.id } });
  } else if (existing) {
    await adminDb.featureFlag.update({ where: { id: existing.id }, data: { enabled: v.enabled, note: v.note ?? existing.note } });
  } else {
    await adminDb.featureFlag.create({ data: { key, orgId: v.orgId, enabled: v.enabled, note: v.note ?? null } });
  }
  await platformAudit(p, { action: v.enabled === null ? "flag.cleared" : "flag.set", targetType: "FeatureFlag", targetId: `${key}${v.orgId ? `@${v.orgId}` : ""}`, before: existing ? { enabled: existing.enabled } : null, after: { enabled: v.enabled } });
}

// ─── Announcements & releases ────────────────────────────────────────────────

export async function createAnnouncement(p: PlatformCtx, v: { title: string; body: string; level: "INFO" | "WARNING"; orgIds: string[]; endsAt: string | null }) {
  if (v.title.trim().length < 3) throw new UserFacingError("Add a title", { title: "Required" });
  if (!v.body.trim()) throw new UserFacingError("Add a message", { body: "Required" });
  const a = await adminDb.platformAnnouncement.create({ data: { title: v.title.trim().slice(0, 140), body: v.body.trim().slice(0, 2000), level: v.level, orgIds: v.orgIds, endsAt: v.endsAt ? new Date(v.endsAt) : null, createdById: p.userId } });
  await platformAudit(p, { action: "announcement.created", targetType: "PlatformAnnouncement", targetId: a.id, after: { title: a.title, orgIds: a.orgIds.length ? a.orgIds : "all" } });
  return a;
}

export async function endAnnouncement(p: PlatformCtx, id: string) {
  await adminDb.platformAnnouncement.update({ where: { id }, data: { deletedAt: new Date() } });
  await platformAudit(p, { action: "announcement.ended", targetType: "PlatformAnnouncement", targetId: id });
}

/** Announcements a company should see right now. */
export async function activeAnnouncements(orgId: string, now = new Date()) {
  return adminDb.platformAnnouncement.findMany({
    where: { deletedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], AND: [{ OR: [{ orgIds: { isEmpty: true } }, { orgIds: { has: orgId } }] }] },
    orderBy: { startsAt: "desc" },
    take: 3,
  });
}

const SEMVER = /^\d+\.\d+\.\d+$/;
export async function publishRelease(p: PlatformCtx, v: { version: string; channel: "stable" | "beta"; notes: string; minVersion: string | null }) {
  if (!SEMVER.test(v.version)) throw new UserFacingError("Use a version like 1.4.0", { version: "Invalid" });
  if (v.minVersion && !SEMVER.test(v.minVersion)) throw new UserFacingError("Use a version like 1.2.0", { minVersion: "Invalid" });
  if (await adminDb.release.findUnique({ where: { version: v.version } })) throw new UserFacingError("That version is already published", { version: "Taken" });
  const r = await adminDb.release.create({ data: { version: v.version, channel: v.channel, notes: v.notes.trim().slice(0, 10_000), minVersion: v.minVersion, createdById: p.userId } });
  await platformAudit(p, { action: "release.published", targetType: "Release", targetId: r.id, after: { version: r.version, minVersion: r.minVersion } });
  return r;
}

/** Compare "1.10.0" > "1.9.3". */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

// ─── Billing: free beta / comped companies ────────────────────────────────────

/** Make a company free ("Comped / Beta") — no card needed. Optional end date (YYYY-MM-DD). */
export async function compOrg(p: PlatformCtx, orgId: string, v: { reason: string; until: string | null; kind?: "COMPLIMENTARY" | "BETA" }) {
  const r = needReason(v.reason);
  let until: Date | null = null;
  if (v.until) {
    until = new Date(`${v.until}T23:59:59.000Z`);
    if (Number.isNaN(until.getTime())) throw new UserFacingError("Pick a valid end date", { until: "Invalid date" });
    if (until <= new Date()) throw new UserFacingError("The end date must be in the future", { until: "Must be in the future" });
  }
  const org = await adminDb.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new UserFacingError("Company not found");
  const { getSubscription, setComp } = await import("@/server/billing/subscription");
  const before = await getSubscription(orgId);
  const after = await setComp(orgId, { reason: r, until, kind: v.kind });
  await platformAudit(p, { action: "billing.comped", targetType: "Organization", targetId: orgId, reason: r, before: { status: before.status, compUntil: before.compUntil }, after: { status: after.status, compUntil: after.compUntil } });
}

export async function endCompOrg(p: PlatformCtx, orgId: string, reason: string) {
  const r = needReason(reason);
  const { getSubscription, endComp } = await import("@/server/billing/subscription");
  const before = await getSubscription(orgId);
  if (before.status !== "COMPLIMENTARY" && before.status !== "BETA") throw new UserFacingError("This company isn't on a free plan.");
  const after = await endComp(orgId);
  await platformAudit(p, { action: "billing.comp_ended", targetType: "Organization", targetId: orgId, reason: r, before: { status: before.status, compReason: before.compReason }, after: { status: after.status, trialEndsAt: after.trialEndsAt } });
}
