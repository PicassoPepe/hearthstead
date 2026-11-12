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
  if (!p.addressLine1 || !p.city || !p.state || !p.postalCode) throw new UserFacingError("Add a street, city, state and ZIP before looking up land records.");
  let result: ParcelResult;
  try {
    result = await lookup({ addressLine1: p.addressLine1, city: p.city, state: p.state, postalCode: p.postalCode, ownerHint: p.ownerships.length ? p.ownerships.map((o) => ownerDisplayName(o.owner)).join(" & ") : null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lookup failed";
    await db.parcelRecord.upsert({ where: { propertyId }, update: { status: "ERROR", error: message, fetchedAt: new Date() }, create: { organizationId: db.ctx.orgId, propertyId, source: "error", status: "ERROR", error: message } });
    throw new UserFacingError(`Couldn't reach the land-records service: ${message}. Try again later.`);
  }
  const existing = await db.parcelRecord.findFirst({ where: { propertyId } });
  // Never replace details someone entered by hand with "not found" — just update the map point.
  if (existing?.source === "manual" && result.status !== "LOOKED_UP") {
    return db.parcelRecord.update({ where: { propertyId }, data: { latitude: result.latitude ?? existing.latitude, longitude: result.longitude ?? existing.longitude, countyFips: result.countyFips ?? existing.countyFips, countyName: result.countyName ?? existing.countyName, links: (result.links.length ? result.links : existing.links) as object, error: null, fetchedAt: new Date() } });
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
  const stale = await db.parcelRecord.findMany({ where: { fetchedAt: { lt: cutoff }, source: { not: "manual" } }, select: { propertyId: true }, take: limit });
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

export type ManualLandRecord = { parcelId?: string; ownerName?: string; acres?: number | null; landUse?: string; assessedValueCents?: number | null; taxYear?: number | null; lastSaleDate?: string; lastSalePriceCents?: number | null; deedBook?: string; deedPage?: string; legalDescription?: string };

/** Staff enter what they found (PVA site, deed, Zillow…) — kept until someone changes it. */
export async function saveManualLandRecord(db: ScopedDb, propertyId: string, v: ManualLandRecord) {
  if (!(await db.property.findFirst({ where: { id: propertyId } }))) throw new UserFacingError("Property not found");
  const t = (x?: string) => (x?.trim() ? x.trim().slice(0, 500) : null);
  if (v.lastSaleDate && !/^\d{4}-\d{2}-\d{2}$/.test(v.lastSaleDate)) throw new UserFacingError("Use a full date", { lastSaleDate: "YYYY-MM-DD" });
  if (v.acres != null && (!Number.isFinite(v.acres) || v.acres < 0)) throw new UserFacingError("Acres must be a number", { acres: "Number" });
  const data = {
    source: "manual", status: "LOOKED_UP", error: null, parcelId: t(v.parcelId), ownerName: t(v.ownerName)?.toUpperCase() ?? null, acres: v.acres ?? null, landUse: t(v.landUse),
    assessedValueCents: v.assessedValueCents ?? null, taxYear: v.taxYear ?? null, lastSaleDate: t(v.lastSaleDate), lastSalePriceCents: v.lastSalePriceCents ?? null,
    deedBook: t(v.deedBook), deedPage: t(v.deedPage), legalDescription: t(v.legalDescription), fetchedAt: new Date(),
  };
  const rec = await db.parcelRecord.upsert({ where: { propertyId }, update: data, create: { organizationId: db.ctx.orgId, propertyId, ...data } });
  await audit(db, { action: "land_record.entered", entityType: "Property", entityId: propertyId, after: { parcelId: data.parcelId, ownerName: data.ownerName } });
  return rec;
}
