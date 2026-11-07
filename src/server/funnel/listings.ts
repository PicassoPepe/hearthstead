import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getLlmProvider } from "@/adapters/llm";
import { parseISODate, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export type ListingInput = { unitId: string; title: string; description: string; rentCents: number; depositCents: number; availableOn?: string | null; leaseTermMonths: number; petPolicy: string; syndicate: boolean };

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "listing";

async function uniqueSlug(db: ScopedDb, base: string, exceptId?: string) {
  let slug = slugify(base);
  for (let i = 2; await db.listing.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}

/** Is the unit occupied (or about to be) by an active lease today? */
export async function unitIsLeased(db: ScopedDb, unitId: string, today = new Date()) {
  return Boolean(await db.leaseUnit.findFirst({ where: { unitId, lease: { status: { in: ["ACTIVE", "EVICTION"] }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: today } }] } } }));
}

export async function saveListing(db: ScopedDb, id: string | null, v: ListingInput) {
  const unit = await db.unit.findFirst({ where: { id: v.unitId }, include: { property: true } });
  if (!unit) throw new UserFacingError("Choose a unit", { unitId: "Choose a unit" });
  if (v.title.trim().length < 5) throw new UserFacingError("Give the listing a headline", { title: "Required" });
  if (!Number.isSafeInteger(v.rentCents) || v.rentCents <= 0) throw new UserFacingError("Enter the asking rent", { rentCents: "Required" });
  if (!id && (await db.listing.findFirst({ where: { unitId: v.unitId, status: { in: ["DRAFT", "PUBLISHED"] } } }))) throw new UserFacingError("This unit already has a listing — edit that one");
  const data = {
    unitId: unit.id, propertyId: unit.propertyId, title: v.title.trim(), description: v.description.trim(), rentCents: v.rentCents, depositCents: v.depositCents,
    availableOn: v.availableOn ? parseISODate(v.availableOn) : null, leaseTermMonths: v.leaseTermMonths, petPolicy: v.petPolicy, syndicate: v.syndicate,
  };
  const l = id
    ? await db.listing.update({ where: { id }, data })
    : await db.listing.create({ data: { organizationId: db.ctx.orgId, createdById: db.ctx.userId, slug: await uniqueSlug(db, `${unit.property.name} ${unit.name}`), ...data } });
  await audit(db, { action: id ? "listing.updated" : "listing.created", entityType: "Listing", entityId: l.id, after: data });
  return l;
}

export async function setListingStatus(db: ScopedDb, id: string, status: "PUBLISHED" | "UNLISTED" | "DRAFT", reason?: string) {
  const l = await db.listing.findFirst({ where: { id } });
  if (!l) throw new UserFacingError("Listing not found");
  if (status === "PUBLISHED") {
    if (await unitIsLeased(db, l.unitId)) throw new UserFacingError("This unit has an active lease. End or set a move-out date on that lease before listing it.");
    if (l.description.trim().length < 40) throw new UserFacingError("Add a description (at least a couple of sentences) before publishing — or use AI description.");
  }
  await db.listing.update({ where: { id }, data: { status, publishedAt: status === "PUBLISHED" ? new Date() : l.publishedAt, unlistedReason: status === "UNLISTED" ? reason ?? "Unlisted by staff" : null } });
  await db.unit.update({ where: { id: l.unitId }, data: { isListed: status === "PUBLISHED" } });
  await audit(db, { action: `listing.${status.toLowerCase()}`, entityType: "Listing", entityId: id, after: { reason } });
}

/** Auto-delist: any published listing whose unit now has an active lease. Run on lease creation and nightly. */
export async function autoDelist(db: ScopedDb, today = new Date()) {
  const live = await db.listing.findMany({ where: { status: "PUBLISHED" } });
  let n = 0;
  for (const l of live) {
    if (await unitIsLeased(db, l.unitId, today)) {
      await db.listing.update({ where: { id: l.id }, data: { status: "UNLISTED", unlistedReason: "Leased — removed automatically" } });
      await db.unit.update({ where: { id: l.unitId }, data: { isListed: false } });
      await audit(db, { action: "listing.auto_delisted", entityType: "Listing", entityId: l.id, actorType: "SYSTEM" });
      n++;
    }
  }
  return n;
}

/** AI listing description from the unit's facts (mock is deterministic). Never invents amenities. */
export async function describeListing(db: ScopedDb, unitId: string, rentCents: number, petPolicy: string) {
  const unit = await db.unit.findFirst({ where: { id: unitId }, include: { property: true } });
  if (!unit) throw new UserFacingError("Choose a unit");
  const facts = [
    `Property: ${unit.property.name} (${unit.property.type.toLowerCase().replace(/_/g, " ")}) at ${unit.property.addressLine1}, ${unit.property.city}, ${unit.property.state}`,
    `Unit: ${unit.name}`,
    unit.beds !== null ? `Bedrooms: ${unit.beds}` : null,
    unit.bathsTenths !== null ? `Bathrooms: ${unit.bathsTenths / 10}` : null,
    unit.sqft ? `Square feet: ${unit.sqft}` : null,
    `Rent: ${formatMoney(rentCents)} per month`,
    unit.amenities.length ? `Amenities: ${unit.amenities.join(", ")}` : null,
    `Pets: ${petPolicy}`,
    unit.property.yearBuilt ? `Built: ${unit.property.yearBuilt}` : null,
  ].filter(Boolean).join("\n");
  const text = await getLlmProvider().complete({
    purpose: "listing-description",
    system: "Write an inviting, accurate rental listing description in 3 short paragraphs. Use only the facts given — never invent amenities, distances or policies. Fair-housing compliant: describe the property, not who should live there.",
    messages: [{ role: "user", content: facts }],
    maxTokens: 500,
  });
  await audit(db, { action: "ai.listing_description", entityType: "Unit", entityId: unitId });
  return text;
}

// ---------------------------------------------------------------- prospects & showings

export async function createProspect(db: ScopedDb, v: { firstName: string; lastName: string; email?: string | null; phone?: string | null; source?: string; listingId?: string | null; notes?: string | null }) {
  if (!v.firstName.trim() || !v.lastName.trim()) throw new UserFacingError("Enter the prospect's name", { firstName: "Required" });
  if (!v.email && !v.phone) throw new UserFacingError("Add an email or phone so you can follow up", { email: "Email or phone" });
  const existing = v.email ? await db.prospect.findFirst({ where: { email: v.email.toLowerCase() } }) : null;
  if (existing) return existing;
  const p = await db.prospect.create({ data: { organizationId: db.ctx.orgId, firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email?.toLowerCase() || null, phone: v.phone || null, source: v.source ?? "WEBSITE", listingId: v.listingId ?? null, notes: v.notes ?? null, createdById: db.ctx.userId } });
  await audit(db, { action: "prospect.created", entityType: "Prospect", entityId: p.id });
  return p;
}

export async function scheduleShowing(db: ScopedDb, v: { listingId: string; prospectId: string; startsAt: string; durationMin?: number; agentUserId?: string | null; source?: "STAFF" | "SELF_SCHEDULED"; notes?: string }) {
  const listing = await db.listing.findFirst({ where: { id: v.listingId } });
  if (!listing) throw new UserFacingError("Choose a listing");
  if (!(await db.prospect.findFirst({ where: { id: v.prospectId } }))) throw new UserFacingError("Choose a prospect");
  const start = new Date(v.startsAt);
  if (Number.isNaN(start.getTime())) throw new UserFacingError("Pick a time", { startsAt: "Pick a time" });
  if (start.getTime() < Date.now() - 5 * 60_000) throw new UserFacingError("Pick a time in the future", { startsAt: "In the past" });
  const dur = v.durationMin ?? 30;
  const end = new Date(start.getTime() + dur * 60_000);
  // No double-booking the same listing.
  const clash = (await db.showing.findMany({ where: { listingId: v.listingId, status: "SCHEDULED", startsAt: { gte: new Date(start.getTime() - 4 * 3_600_000), lte: end } } }))
    .find((s) => s.startsAt < end && new Date(s.startsAt.getTime() + s.durationMin * 60_000) > start);
  if (clash) throw new UserFacingError("That time overlaps another showing for this unit", { startsAt: "Overlaps another showing" });
  const s = await db.showing.create({ data: { organizationId: db.ctx.orgId, listingId: v.listingId, prospectId: v.prospectId, startsAt: start, durationMin: dur, agentUserId: v.agentUserId ?? null, source: v.source ?? "STAFF", notes: v.notes ?? null, createdById: db.ctx.userId } });
  await db.prospect.updateMany({ where: { id: v.prospectId, status: { in: ["NEW", "CONTACTED"] } }, data: { status: "CONTACTED" } });
  await audit(db, { action: "showing.scheduled", entityType: "Showing", entityId: s.id, after: { startsAt: start.toISOString() } });
  return s;
}

export async function setShowingStatus(db: ScopedDb, id: string, status: "COMPLETED" | "NO_SHOW" | "CANCELED") {
  const s = await db.showing.findFirst({ where: { id } });
  if (!s) throw new UserFacingError("Showing not found");
  await db.showing.update({ where: { id }, data: { status } });
  if (status === "COMPLETED") await db.prospect.updateMany({ where: { id: s.prospectId, status: { in: ["NEW", "CONTACTED"] } }, data: { status: "TOURED" } });
  await audit(db, { action: `showing.${status.toLowerCase()}`, entityType: "Showing", entityId: id });
}

export const listingDay = (d: Date | null) => (d ? toISODate(d) : null);
