import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import type { ScopedDb } from "@/server/dal";
import type { AppContext } from "@/server/context";
import { getSettings } from "@/server/settings/service";
import { todayIn } from "@/lib/dates";

export type OwnerPortalContext = {
  user: { id: string; email: string };
  owner: { id: string; name: string; email: string | null };
  org: { id: string; name: string; brandColor: string; logoUrl: string | null; phone: string | null; email: string | null; timezone: string };
  /** Properties this owner owns (ownership not deleted). Every query MUST filter by these. */
  properties: { id: string; name: string; percentBps: number }[];
  propertyIds: string[];
  db: ScopedDb;
  today: Date;
  settings: { showTenantNames: boolean; showReports: boolean };
};

export const ownerName = (o: { kind: string; firstName: string | null; lastName: string | null; companyName: string | null }) =>
  o.kind === "COMPANY" ? o.companyName ?? "Owner" : [o.firstName, o.lastName].filter(Boolean).join(" ") || "Owner";

/** Resolve the signed-in owner. Cached per request. Owners never see other owners' data. */
export const getOwnerPortalContext = cache(async (): Promise<OwnerPortalContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await adminDb.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return null;
  // System lookup scoped by userId: which owner records is this login linked to?
  const links = await adminDb.ownerUser.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  for (const link of links) {
    const org = await adminDb.organization.findUnique({ where: { id: link.organizationId } });
    if (!org || org.deletedAt) continue;
    const db = forOrg({ orgId: org.id, userId });
    const owner = await db.owner.findFirst({ where: { id: link.ownerId }, include: { ownerships: { where: { deletedAt: null, property: { deletedAt: null } }, include: { property: { select: { id: true, name: true } } }, orderBy: { property: { name: "asc" } } } } });
    if (!owner) continue;
    const s = await getSettings(db, ["ownerPortal.enabled", "ownerPortal.showTenantNames", "ownerPortal.showReports"], { orgId: org.id });
    if (!s["ownerPortal.enabled"].value) continue;
    if (!link.acceptedAt) {
      await adminDb.ownerUser.update({ where: { id: link.id }, data: { acceptedAt: new Date() } });
      await adminDb.owner.update({ where: { id: owner.id }, data: { portalStatus: "ACTIVE" } });
    }
    const properties = owner.ownerships.map((o) => ({ id: o.property.id, name: o.property.name, percentBps: o.percentBps }));
    return {
      user,
      owner: { id: owner.id, name: ownerName(owner), email: owner.email },
      org: { id: org.id, name: org.name, brandColor: org.brandColor, logoUrl: org.logoUrl, phone: org.phone, email: org.email, timezone: org.timezone },
      properties,
      propertyIds: properties.map((p) => p.id),
      db,
      today: todayIn(org.timezone),
      settings: { showTenantNames: s["ownerPortal.showTenantNames"].value, showReports: s["ownerPortal.showReports"].value },
    };
  }
  return null;
});

export async function requireOwnerPortal(): Promise<OwnerPortalContext> {
  const ctx = await getOwnerPortalContext();
  if (!ctx) {
    const session = await auth();
    redirect(session?.user ? "/portal/no-access" : "/login?portal=owner&callbackUrl=%2Fportal%2Fowner");
  }
  return ctx;
}

export async function hasOwnerPortal(userId: string): Promise<boolean> {
  return (await adminDb.ownerUser.count({ where: { userId, deletedAt: null } })) > 0;
}

/**
 * A report-engine context limited to the owner's properties. The engine intersects every filter
 * with `propertyScope`, so an owner can never widen it. An owner with no properties gets an
 * impossible id rather than an empty scope (which would mean "all").
 */
export function ownerReportContext(o: OwnerPortalContext): AppContext {
  return {
    db: o.db,
    org: { id: o.org.id, name: o.org.name },
    user: { id: o.user.id, email: o.user.email, name: o.owner.name, preferences: {} },
    membership: { propertyScope: o.propertyIds.length ? o.propertyIds : ["__none__"], roleKey: "OWNER_PORTAL" },
    permissions: {},
  } as unknown as AppContext;
}
