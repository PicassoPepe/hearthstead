import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import type { ScopedDb } from "@/server/dal";
import {
  can,
  parsePermissions,
  PermissionError,
  type Level,
  type Module,
  type PermissionSet,
} from "@/server/permissions";

export const ORG_COOKIE = "hs_org";

export type AppContext = {
  user: { id: string; email: string; name: string | null; preferences: Record<string, unknown> };
  org: { id: string; name: string; slug: string; brandColor: string; logoUrl: string | null; sandbox: boolean };
  membership: { id: string; roleId: string; roleName: string; roleKey: string | null; propertyScope: string[] };
  permissions: PermissionSet;
  orgs: { id: string; name: string; slug: string }[];
  db: ScopedDb;
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

  const jar = await cookies();
  const wanted = jar.get(ORG_COOKIE)?.value ?? user.lastOrgId;
  const m = user.memberships.find((x) => x.organizationId === wanted) ?? user.memberships[0]!;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      preferences: (user.preferences ?? {}) as Record<string, unknown>,
    },
    org: {
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      brandColor: m.organization.brandColor,
      logoUrl: m.organization.logoUrl,
      sandbox: m.organization.sandbox,
    },
    membership: {
      id: m.id,
      roleId: m.roleId,
      roleName: m.role.name,
      roleKey: m.role.key,
      propertyScope: m.propertyScope,
    },
    permissions: parsePermissions(m.role.permissions),
    orgs: user.memberships.map((x) => ({ id: x.organization.id, name: x.organization.name, slug: x.organization.slug })),
    db: forOrg({ orgId: m.organizationId, userId: user.id }),
  };
});

/** For pages: redirect to sign-in when there's no context. */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) {
    const session = await auth();
    if (session?.user?.id && (await adminDb.tenantUser.count({ where: { userId: session.user.id, deletedAt: null } }))) redirect("/portal/tenant");
    if (session?.user?.id && (await adminDb.ownerUser.count({ where: { userId: session.user.id, deletedAt: null } }))) redirect("/portal/owner");
    redirect(session?.user ? "/signup?step=org" : "/login");
  }
  return ctx;
}

/** For server actions and route handlers: throws PermissionError instead of redirecting. */
export async function requirePermission(module: Module, level: Exclude<Level, "none"> = "view"): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new PermissionError(module, level);
  if (!can(ctx.permissions, module, level)) throw new PermissionError(module, level);
  return ctx;
}

/** For pages: render a 403 state rather than throwing. */
export async function pagePermission(module: Module, level: Exclude<Level, "none"> = "view") {
  const ctx = await requireContext();
  return { ctx, allowed: can(ctx.permissions, module, level) };
}
