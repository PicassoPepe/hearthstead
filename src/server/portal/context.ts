import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import type { ScopedDb } from "@/server/dal";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { todayIn } from "@/lib/dates";
import { tenantDisplayName } from "@/lib/leasing";

export const PREVIEW_COOKIE = "dw_preview_tenant";
export const PORTAL_LEASE_COOKIE = "dw_portal_lease";

export type PortalContext = {
  user: { id: string; email: string };
  tenant: { id: string; name: string; email: string | null };
  org: { id: string; name: string; brandColor: string; logoUrl: string | null; phone: string | null; email: string | null; timezone: string };
  leases: { id: string; label: string; status: string; propertyId: string }[];
  lease: { id: string; label: string; status: string; propertyId: string } | null;
  db: ScopedDb;
  /** Staff "Preview portal as" — read-only, every write is refused. */
  preview: boolean;
  today: Date;
};

async function build(orgId: string, tenantId: string, user: { id: string; email: string }, preview: boolean): Promise<PortalContext | null> {
  const org = await adminDb.organization.findUnique({ where: { id: orgId } });
  if (!org || org.deletedAt) return null;
  const db = forOrg({ orgId, userId: preview ? user.id : user.id });
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId },
    include: { leases: { include: { lease: { include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } } } } },
  });
  if (!tenant) return null;
  const leases = tenant.leases
    .filter((l) => l.lease.status !== "DRAFT")
    .map((l) => ({ id: l.leaseId, propertyId: l.lease.propertyId, status: l.lease.status, label: `${l.lease.property.name} · ${l.lease.units.map((u) => u.unit.name).join(", ")}`, start: l.lease.startDate }))
    .sort((a, b) => Number(b.status !== "ENDED") - Number(a.status !== "ENDED") || b.start.getTime() - a.start.getTime());
  const jar = await cookies();
  const wanted = jar.get(PORTAL_LEASE_COOKIE)?.value;
  const lease = leases.find((l) => l.id === wanted) ?? leases[0] ?? null;
  return {
    user,
    tenant: { id: tenant.id, name: tenantDisplayName(tenant), email: tenant.email },
    org: { id: org.id, name: org.name, brandColor: org.brandColor, logoUrl: org.logoUrl, phone: org.phone, email: org.email, timezone: org.timezone },
    leases: leases.map(({ start: _s, ...l }) => l),
    lease: lease ? { id: lease.id, label: lease.label, status: lease.status, propertyId: lease.propertyId } : null,
    db,
    preview,
    today: todayIn(org.timezone),
  };
}

/** Resolve the signed-in tenant (or a staff preview). Cached per request. */
export const getPortalContext = cache(async (): Promise<PortalContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await adminDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return null;

  const jar = await cookies();
  const previewTenant = jar.get(PREVIEW_COOKIE)?.value;
  if (previewTenant) {
    const staff = await getContext();
    if (staff && can(staff.permissions, "people", "view")) {
      const ctx = await build(staff.org.id, previewTenant, user, true);
      if (ctx) return ctx;
    }
  }

  // System lookup scoped by userId: which tenant records is this login linked to?
  const links = await adminDb.tenantUser.findMany({ where: { userId, deletedAt: null, tenant: { portalPausedAt: null } }, orderBy: { createdAt: "asc" } });
  for (const link of links) {
    const ctx = await build(link.organizationId, link.tenantId, user, false);
    if (!ctx) continue;
    if (!link.acceptedAt) {
      await adminDb.tenantUser.update({ where: { id: link.id }, data: { acceptedAt: new Date() } });
      await adminDb.tenant.update({ where: { id: link.tenantId }, data: { portalStatus: "ACTIVE" } });
    }
    return ctx;
  }
  return null;
});

export async function requirePortal(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (!ctx) {
    const session = await auth();
    if (session?.user?.id && (await adminDb.tenantUser.count({ where: { userId: session.user.id, deletedAt: null, tenant: { portalPausedAt: { not: null } } } }))) redirect("/portal/no-access?paused=1");
    redirect(session?.user ? "/portal/no-access" : "/login?portal=resident&callbackUrl=%2Fportal%2Ftenant");
  }
  return ctx;
}

/** Does this login have a tenant portal (and no staff membership)? Used to route after sign-in. */
export async function hasTenantPortal(userId: string): Promise<boolean> {
  return (await adminDb.tenantUser.count({ where: { userId, deletedAt: null, tenant: { portalPausedAt: null } } })) > 0;
}
