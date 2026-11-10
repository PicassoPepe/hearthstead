import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import type { ScopedDb } from "@/server/dal";
import { localLicense } from "@/server/license/local";
import { UserFacingError } from "@/server/action-result";
import { IMPERSONATE_COOKIE, activeImpersonation, isPlatformAdmin } from "@/server/platform-admin/service";
import { mustChangePasswordBlocks } from "@/lib/must-change-password";
import {
  can,
  parsePermissions,
  PermissionError,
  type Level,
  type Module,
  type PermissionSet,
} from "@/server/permissions";

export const ORG_COOKIE = "dw_org";

export type AppContext = {
  user: { id: string; email: string; name: string | null; preferences: Record<string, unknown>; mustChangePassword: boolean };
  org: { id: string; name: string; slug: string; brandColor: string; logoUrl: string | null; sandbox: boolean; suspended: boolean };
  membership: { id: string; roleId: string; roleName: string; roleKey: string | null; propertyScope: string[] };
  permissions: PermissionSet;
  orgs: { id: string; name: string; slug: string }[];
  db: ScopedDb;
  /** Set while the platform owner is viewing this company as `user` (from /admin). */
  impersonation?: { id: string; adminUserId: string; adminEmail: string; reason: string; expiresAt: string };
};

/**
 * Resolve the signed-in user's active organization and permissions. Cached per request.
 * Returns null when signed out or when the user has no active membership.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  // Signing in (magic link or password) proves ownership of the invited email: accept invites.
  await adminDb.membership.updateMany({
    where: { userId, status: "INVITED", deletedAt: null },
    data: { status: "ACTIVE", acceptedAt: new Date() },
  });

  // Platform owner "view as": act as a member of one company, for a limited time, with a reason.
  const jar = await cookies();
  const impId = jar.get(IMPERSONATE_COOKIE)?.value;
  if (impId) {
    const imp = await activeImpersonation(userId, impId);
    if (imp) {
      const admin = await adminDb.user.findUnique({ where: { id: userId }, select: { email: true } });
      const ctx = await buildContext(imp.asUserId, imp.orgId, { onlyOrg: imp.orgId, impersonatorId: userId });
      if (ctx) return { ...ctx, impersonation: { id: imp.id, adminUserId: userId, adminEmail: admin?.email ?? "", reason: imp.reason, expiresAt: imp.expiresAt.toISOString() } };
    }
  }
  return buildContext(userId, jar.get(ORG_COOKIE)?.value);
});

async function buildContext(userId: string, wantedOrg: string | undefined, opts: { onlyOrg?: string; impersonatorId?: string } = {}): Promise<AppContext | null> {
  // System lookup scoped explicitly by userId (the user may belong to several orgs).
  const user = await adminDb.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: "ACTIVE", deletedAt: null, organization: { deletedAt: null } },
        include: { organization: true, role: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user || user.deletedAt || user.memberships.length === 0) return null;

  const wanted = opts.onlyOrg ?? wantedOrg ?? user.lastOrgId;
  const m = user.memberships.find((x) => x.organizationId === wanted) ?? (opts.onlyOrg ? undefined : user.memberships[0]);
  if (!m) return null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      preferences: (user.preferences ?? {}) as Record<string, unknown>,
      mustChangePassword: user.mustChangePassword,
    },
    org: {
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      brandColor: m.organization.brandColor,
      logoUrl: m.organization.logoUrl,
      sandbox: m.organization.sandbox,
      suspended: Boolean(m.organization.suspendedAt),
    },
    membership: {
      id: m.id,
      roleId: m.roleId,
      roleName: m.role.name,
      roleKey: m.role.key,
      propertyScope: m.propertyScope,
    },
    permissions: parsePermissions(m.role.permissions),
    orgs: (opts.onlyOrg ? [m] : user.memberships).map((x) => ({ id: x.organization.id, name: x.organization.name, slug: x.organization.slug })),
    db: forOrg({ orgId: m.organizationId, userId: user.id, impersonatorId: opts.impersonatorId ?? null }),
  };
}

/** For pages: redirect to sign-in when there's no context. */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) {
    const session = await auth();
    if (session?.user?.id && (await adminDb.tenantUser.count({ where: { userId: session.user.id, deletedAt: null } }))) redirect("/portal/tenant");
    if (session?.user?.id && (await adminDb.ownerUser.count({ where: { userId: session.user.id, deletedAt: null } }))) redirect("/portal/owner");
    if (session?.user?.id && (await isPlatformAdmin(session.user.id))) redirect("/admin");
    redirect(session?.user ? "/signup?step=org" : "/login");
  }
  if (ctx.org.suspended && !ctx.impersonation) redirect("/suspended");
  return ctx;
}

/** For server actions and route handlers: throws PermissionError instead of redirecting. */
export async function requirePermission(module: Module, level: Exclude<Level, "none"> = "view", opts: { billing?: boolean } = {}): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new PermissionError(module, level);
  if (mustChangePasswordBlocks(ctx.user, Boolean(ctx.impersonation))) throw new UserFacingError("Choose a new password before continuing.");
  if (ctx.org.suspended && !ctx.impersonation) throw new PermissionError(module, level);
  if (!can(ctx.permissions, module, level)) throw new PermissionError(module, level);
  // Computer installs whose license or trial has ended are read-only (nothing is deleted).
  if (level !== "view") {
    const lic = localLicense();
    if (lic.readOnly && !(module === "settings" && level === "edit")) throw new UserFacingError(lic.message);
    // Hosted companies whose trial ended or payment lapsed (only when BILLING_ENFORCED=1). Billing actions stay open.
    if (!opts.billing && !ctx.impersonation) {
      const { billingReadOnly } = await import("@/server/billing/subscription");
      if (await billingReadOnly(ctx.org.id)) throw new UserFacingError("Your DeedWood plan needs attention — the account is read-only until you choose a plan in Settings → Billing. Nothing has been deleted.");
    }
  }
  return ctx;
}

/** For pages: render a 403 state rather than throwing. */
export async function pagePermission(module: Module, level: Exclude<Level, "none"> = "view") {
  const ctx = await requireContext();
  return { ctx, allowed: can(ctx.permissions, module, level) };
}
