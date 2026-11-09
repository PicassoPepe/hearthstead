"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { cookieOptions } from "@/lib/cookies";
import * as P from "@/server/platform-admin/service";
import { getPlatformCtx } from "@/server/platform-admin/access";

/** Every owner-console action: platform admin + two-factor + allowed address, or nothing happens. */
async function withAdmin<T>(fn: (p: P.PlatformCtx) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  return runAction(async () => {
    let p: P.PlatformCtx;
    try {
      p = await getPlatformCtx();
    } catch (e) {
      if (e instanceof P.PlatformAccessError) throw new UserFacingError(e.message);
      throw e;
    }
    const r = await fn(p);
    revalidatePath("/admin", "layout");
    return r;
  }, message);
}

export async function suspendOrgAction(orgId: string, reason: string, code: string) {
  return withAdmin((p) => P.suspendOrg(p, orgId, reason, code), "Company paused");
}
export async function reinstateOrgAction(orgId: string, reason: string) {
  return withAdmin((p) => P.reinstateOrg(p, orgId, reason), "Company turned back on");
}
export async function forceLogoutOrgAction(orgId: string, reason: string) {
  return withAdmin((p) => P.forceLogoutOrg(p, orgId, reason), "Everyone in the company was signed out");
}
export async function resetUserMfaAction(userId: string, reason: string, code: string) {
  return withAdmin((p) => P.resetUserMfa(p, userId, reason, code), "Two-factor reset — they'll set it up again at next sign-in");
}
export async function revokeUserSessionsAction(userId: string, reason: string) {
  return withAdmin((p) => P.revokeUserSessions(p, userId, reason), "Signed out of every device");
}

export async function startImpersonationAction(orgId: string, asUserId: string, reason: string, code: string, minutes = 30) {
  return withAdmin(async (p) => {
    const imp = await P.startImpersonation(p, { orgId, asUserId, reason, code, minutes });
    (await cookies()).set(P.IMPERSONATE_COOKIE, imp.id, cookieOptions({ maxAge: P.MAX_IMPERSONATION_MIN * 60 }));
    return { expiresAt: imp.expiresAt.toISOString() };
  });
}

/** Works from inside the staff app (the banner's "Stop viewing" button). */
export async function endImpersonationAction(): Promise<ActionResult<{ orgId: string | null }>> {
  return runAction(async () => {
    const s = await auth();
    const jar = await cookies();
    const id = jar.get(P.IMPERSONATE_COOKIE)?.value;
    jar.delete(P.IMPERSONATE_COOKIE);
    if (!s?.user?.id || !id) return { orgId: null };
    const imp = await P.activeImpersonation(s.user.id, id).catch(() => null);
    await P.endImpersonation(s.user.id, id);
    return { orgId: imp?.orgId ?? null };
  });
}

export async function setFlagAction(key: string, orgId: string | null, enabled: boolean | null, note?: string) {
  return withAdmin((p) => P.setFlag(p, { key, orgId, enabled, note }), "Switch saved");
}
export async function createAnnouncementAction(v: { title: string; body: string; level: "INFO" | "WARNING"; orgIds: string[]; endsAt: string | null }) {
  return withAdmin(async (p) => { await P.createAnnouncement(p, v); }, "Announcement posted");
}
export async function endAnnouncementAction(id: string) {
  return withAdmin((p) => P.endAnnouncement(p, id), "Announcement taken down");
}
export async function publishReleaseAction(v: { version: string; channel: "stable" | "beta"; notes: string; minVersion: string | null }) {
  return withAdmin(async (p) => { await P.publishRelease(p, v); }, "Release published");
}

export async function savePlanAction(key: string, edit: import("@/server/billing/catalog").PlanEdit) {
  return withAdmin(async (p) => {
    const { cleanPlanEdit } = await import("@/server/billing/catalog");
    const { adminDb } = await import("@/server/db");
    const data = cleanPlanEdit(edit);
    const before = await adminDb.plan.findUnique({ where: { key } });
    if (!before) throw new UserFacingError("Plan not found");
    await adminDb.plan.update({ where: { key }, data });
    await P.platformAudit(p, { action: "plan.updated", targetType: "Plan", targetId: key, before, after: data });
  }, "Plan saved");
}

export async function issueLicenseAction(v: { customerEmail: string; customerName?: string; planKey: string; maxUnits: number; months: number }) {
  return withAdmin(async (p) => {
    const { issueLicense } = await import("@/server/license/control");
    const l = await issueLicense(p, v);
    return { id: l.id, token: l.token };
  }, "License issued");
}

export async function revokeLicenseAction(id: string, reason: string, code: string) {
  return withAdmin(async (p) => {
    const { revokeLicense } = await import("@/server/license/control");
    await revokeLicense(p, id, reason, code);
  }, "License turned off — the install becomes read-only at its next check-in");
}

export async function compOrgAction(orgId: string, v: { reason: string; until: string | null; kind?: "COMPLIMENTARY" | "BETA" }) {
  return withAdmin((p) => P.compOrg(p, orgId, v), "Company is now free");
}
export async function endCompOrgAction(orgId: string, reason: string) {
  return withAdmin((p) => P.endCompOrg(p, orgId, reason), "Free plan ended — they have a 14-day trial to choose a plan");
}
