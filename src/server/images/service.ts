import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { storeAttachment } from "@/server/records/service";

/**
 * Public images: logos, avatars, property and unit photos. They're stored like any attachment but
 * flagged `public` so portals, the public listings site and the syndication feed can show them
 * without a login. URLs contain the unguessable attachment id.
 */
export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS = 24;
export const imageUrl = (id: string) => `/api/images/${id}`;

export async function storeImage(db: ScopedDb, file: File, category: string, link: { type: "Property" | "Unit"; id: string } | null) {
  if (!IMAGE_TYPES.has(file.type)) throw new UserFacingError(`${file.name}: use a JPG, PNG, WebP or GIF image`);
  if (file.size > MAX_IMAGE_BYTES) throw new UserFacingError(`${file.name} is larger than 8 MB`);
  const a = await storeAttachment(db, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, link, category);
  await db.attachment.update({ where: { id: a.id }, data: { public: true } });
  return a.id;
}

type Target = { kind: "property" | "unit"; id: string };

async function current(db: ScopedDb, t: Target) {
  if (t.kind === "property") {
    const p = await db.property.findFirst({ where: { id: t.id }, select: { photos: true } });
    if (!p) throw new UserFacingError("Property not found");
    return p.photos;
  }
  const u = await db.unit.findFirst({ where: { id: t.id }, select: { photos: true } });
  if (!u) throw new UserFacingError("Unit not found");
  return u.photos;
}

async function save(db: ScopedDb, t: Target, photos: string[]) {
  if (t.kind === "property") await db.property.update({ where: { id: t.id }, data: { photos, photoUrl: photos[0] ? imageUrl(photos[0]) : null } });
  else await db.unit.update({ where: { id: t.id }, data: { photos } });
}

export async function addPhotos(db: ScopedDb, t: Target, files: File[]) {
  const existing = await current(db, t);
  if (!files.length) throw new UserFacingError("Choose at least one photo");
  if (existing.length + files.length > MAX_PHOTOS) throw new UserFacingError(`Up to ${MAX_PHOTOS} photos — remove some first`);
  const ids: string[] = [];
  for (const f of files) ids.push(await storeImage(db, f, t.kind === "property" ? "PropertyPhoto" : "UnitPhoto", { type: t.kind === "property" ? "Property" : "Unit", id: t.id }));
  await save(db, t, [...existing, ...ids]);
  await audit(db, { action: "photos.added", entityType: t.kind === "property" ? "Property" : "Unit", entityId: t.id, after: { count: ids.length } });
  return ids;
}

/** Reorder or remove: `photos` must be a subset (same ids) of the current list. */
export async function setPhotos(db: ScopedDb, t: Target, photos: string[]) {
  const existing = await current(db, t);
  if (photos.some((p) => !existing.includes(p))) throw new UserFacingError("Refresh and try again");
  const removed = existing.filter((p) => !photos.includes(p));
  await save(db, t, photos);
  if (removed.length) await db.attachment.updateMany({ where: { id: { in: removed } }, data: { deletedAt: new Date() } });
}

export async function setOrgLogo(db: ScopedDb, file: File | null) {
  let url: string | null = null;
  if (file) url = imageUrl(await storeImage(db, file, "Logo", null));
  await adminDb.organization.update({ where: { id: db.ctx.orgId }, data: { logoUrl: url } });
  await audit(db, { action: file ? "org.logo_updated" : "org.logo_removed", entityType: "Organization", entityId: db.ctx.orgId });
  return url;
}

export async function setAvatar(db: ScopedDb, userId: string, file: File | null) {
  let url: string | null = null;
  if (file) url = imageUrl(await storeImage(db, file, "Avatar", null));
  await adminDb.user.update({ where: { id: userId }, data: { image: url } });
  return url;
}

/** Cover/gallery URLs for a unit: its own photos, else the property's. */
export function photoUrls(unitPhotos: string[], propertyPhotos: string[] = []) {
  return (unitPhotos.length ? unitPhotos : propertyPhotos).map(imageUrl);
}
