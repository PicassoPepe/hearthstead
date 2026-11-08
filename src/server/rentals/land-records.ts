import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { lookupParcel, type ParcelResult } from "@/adapters/parcels";
import { ownerDisplayName } from "@/lib/rentals";

/**
 * Land records for a property: the county's parcel (outline, owner of record, deed reference,
 * assessed value). Looked up once and stored; refreshed on demand and every ~90 days by the
 * nightly job, so paid sources are hit rarely.
 */
export const REFRESH_DAYS = 90;

function toData(r: ParcelResult) {
  return {
    source: r.source, status: r.status, error: null, latitude: r.latitude, longitude: r.longitude, countyFips: r.countyFips, countyName: r.countyName,
    parcelId: r.parcelId, ownerName: r.ownerName, ownerMailing: r.ownerMailing, situsAddress: r.situsAddress, legalDescription: r.legalDescription,
    acres: r.acres, landUse: r.landUse, assessedValueCents: r.assessedValueCents, taxYear: r.taxYear, lastSaleDate: r.lastSaleDate,
    lastSalePriceCents: r.lastSalePriceCents, deedBook: r.deedBook, deedPage: r.deedPage, geometry: (r.geometry ?? undefined) as object | undefined,
    links: r.links as object, raw: (r.raw ?? undefined) as object | undefined, fetchedAt: new Date(),
  };
}

/** Look up (or refresh) a property's land record. Errors are stored on the record and rethrown as friendly messages. */
export async function refreshLandRecord(db: ScopedDb, propertyId: string, lookup: typeof lookupParcel = lookupParcel) {
  const p = await db.property.findFirst({ where: { id: propertyId }, include: { ownerships: { where: { deletedAt: null }, include: { owner: true }, orderBy: { percentBps: "desc" } } } });
  if (!p) throw new UserFacingError("Property not found");
  let result: ParcelResult;
  try {
    result = await lookup({ addressLine1: p.addressLine1, city: p.city, state: p.state, postalCode: p.postalCode, ownerHint: p.ownerships.length ? p.ownerships.map((o) => ownerDisplayName(o.owner)).join(" & ") : null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lookup failed";
    await db.parcelRecord.upsert({ where: { propertyId }, update: { status: "ERROR", error: message, fetchedAt: new Date() }, create: { organizationId: db.ctx.orgId, propertyId, source: "error", status: "ERROR", error: message } });
    throw new UserFacingError(`Couldn't reach the land-records service: ${message}. Try again later.`);
  }
  const data = toData(result);
  const rec = await db.parcelRecord.upsert({ where: { propertyId }, update: { ...data, error: result.message ?? null }, create: { organizationId: db.ctx.orgId, propertyId, ...data, error: result.message ?? null } });
  await audit(db, { action: "land_record.refreshed", entityType: "Property", entityId: propertyId, after: { source: result.source, status: result.status, parcelId: result.parcelId } });
  return rec;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\b(LLC|INC|CORP|CO|LP|LTD|TRUST|TR|THE|ET|AL|ETAL|ETUX|JR|SR|II|III|AND)\b/g, " ").split(/\s+/).filter((w) => w.length > 1);

/**
 * Does the owner of record match the owners on file? True when every owner on file shares a
 * significant name word (last name / company word) with the county's owner name.
 */
export function ownersMatch(ownerOfRecord: string | null, owners: string[]) {
  if (!ownerOfRecord || !owners.length) return null;
  const record = new Set(norm(ownerOfRecord));
  return owners.every((o) => norm(o).some((w) => record.has(w)));
}

/** Nightly: refresh records older than REFRESH_DAYS, a few per run. (New properties are looked up when created.) */
export async function refreshStaleLandRecords(db: ScopedDb, now = new Date(), limit = 10) {
  const cutoff = new Date(now.getTime() - REFRESH_DAYS * 86_400_000);
  const stale = await db.parcelRecord.findMany({ where: { fetchedAt: { lt: cutoff } }, select: { propertyId: true }, take: limit });
  let done = 0;
  for (const id of stale.map((s) => s.propertyId)) {
    try {
      await refreshLandRecord(db, id);
      done++;
    } catch {
      /* recorded on the record; try again next run */
    }
  }
  return done;
}

/** Everything the land-records panel needs, for staff (/api/files) or owners (/api/owner/files). */
export async function landRecordView(db: ScopedDb, propertyId: string, fileHref: (id: string) => string) {
  const [rec, ownerships, docs] = await Promise.all([
    db.parcelRecord.findFirst({ where: { propertyId } }),
    db.propertyOwnership.findMany({ where: { propertyId, deletedAt: null }, include: { owner: true } }),
    db.attachment.findMany({ where: { entityType: "Property", entityId: propertyId, category: { in: ["Deed", "TitlePolicy", "Survey", "Plat"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const ownersOnFile = ownerships.map((o) => ownerDisplayName(o.owner));
  return {
    record: rec ? {
      status: rec.status, source: rec.source, error: rec.error, fetchedAt: rec.fetchedAt.toISOString(), latitude: rec.latitude, longitude: rec.longitude, countyName: rec.countyName,
      parcelId: rec.parcelId, ownerName: rec.ownerName, ownerMailing: rec.ownerMailing, situsAddress: rec.situsAddress, legalDescription: rec.legalDescription, acres: rec.acres,
      landUse: rec.landUse, assessedValueCents: rec.assessedValueCents, taxYear: rec.taxYear, lastSaleDate: rec.lastSaleDate, lastSalePriceCents: rec.lastSalePriceCents,
      deedBook: rec.deedBook, deedPage: rec.deedPage, geometry: (rec.geometry as { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null) ?? null, links: (rec.links as { label: string; url: string }[]) ?? [],
    } : null,
    ownersOnFile,
    match: rec?.status === "LOOKED_UP" ? ownersMatch(rec.ownerName, ownersOnFile) : null,
    docs: docs.map((d) => ({ id: d.id, name: d.name, category: d.category ?? "Deed", href: fileHref(d.id) })),
  };
}
