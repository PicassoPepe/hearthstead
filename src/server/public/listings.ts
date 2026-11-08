import "server-only";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { accessibleBrand } from "@/server/portal/queries";
import { photoUrls } from "@/server/images/service";

/** Public listing lookups: org by slug (system lookup), then everything through the org-scoped client. */
export async function publicOrg(orgSlug: string) {
  const org = await adminDb.organization.findFirst({ where: { slug: orgSlug, deletedAt: null } });
  if (!org) return null;
  return { org, brand: accessibleBrand(org.brandColor), db: forOrg({ orgId: org.id, userId: null }) };
}

export async function publishedListings(orgSlug: string) {
  const o = await publicOrg(orgSlug);
  if (!o) return null;
  const listings = await o.db.listing.findMany({ where: { status: "PUBLISHED", deletedAt: null }, orderBy: [{ availableOn: "asc" }, { rentCents: "asc" }] });
  const units = await o.db.unit.findMany({ where: { id: { in: listings.map((l) => l.unitId) } }, include: { property: true } });
  return {
    ...o,
    listings: listings.map((l) => {
      const u = units.find((x) => x.id === l.unitId)!;
      return { ...l, unit: u, property: u.property, photos: photoUrls(u.photos, u.property.photos) };
    }),
  };
}
