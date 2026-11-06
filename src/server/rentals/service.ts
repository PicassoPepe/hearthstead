import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import {
  ownerSchema,
  ownershipInputSchema,
  propertyEditSchema,
  propertyWizardSchema,
  PROPERTY_TYPE_META,
  unitInputSchema,
  formatPercentBps,
  type OwnerInput,
  type PropertyEditInput,
  type PropertyWizardInput,
  type UnitInput,
} from "@/lib/rentals";
import { z } from "zod";

/** Optional per-member property scoping (empty = all properties). */
export function propertyScopeWhere(scope: readonly string[]): Prisma.PropertyWhereInput {
  return scope.length ? { id: { in: [...scope] } } : {};
}

function dateOrNull(s: string | null | undefined): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

async function assertBankAccount(db: ScopedDb, id: string | null | undefined, field: string) {
  if (!id) return;
  const a = await db.account.findFirst({ where: { id, isBank: true } });
  if (!a) throw new UserFacingError("Choose a valid bank account", { [field]: "Choose a valid bank account" });
}

async function assertPortfolio(db: ScopedDb, id: string | null | undefined) {
  if (!id) return;
  if (!(await db.portfolio.findFirst({ where: { id } }))) throw new UserFacingError("Choose a valid portfolio", { portfolioId: "Choose a valid portfolio" });
}

// ─── Properties ───────────────────────────────────────────────────────────

export async function createPropertyFromWizard(db: ScopedDb, raw: PropertyWizardInput): Promise<{ id: string }> {
  const v = propertyWizardSchema.parse(raw);
  await assertPortfolio(db, v.portfolioId);
  await assertBankAccount(db, v.defaultOperatingAccountId, "defaultOperatingAccountId");
  await assertBankAccount(db, v.defaultDepositAccountId, "defaultDepositAccountId");
  if (v.owners.length) {
    const found = await db.owner.count({ where: { id: { in: v.owners.map((o) => o.ownerId) } } });
    if (found !== v.owners.length) throw new UserFacingError("One of the owners no longer exists", { owners: "Pick owners again" });
  }

  const orgId = db.ctx.orgId;
  const userId = db.ctx.userId;
  const property = await db.tx(async (tx) => {
    const p = await tx.property.create({
      data: {
        organizationId: orgId,
        name: v.name,
        type: v.type,
        portfolioId: v.portfolioId || null,
        addressLine1: v.address.addressLine1,
        addressLine2: v.address.addressLine2 || null,
        city: v.address.city,
        state: v.address.state,
        postalCode: v.address.postalCode,
        yearBuilt: v.yearBuilt ?? null,
        defaultOperatingAccountId: v.defaultOperatingAccountId || null,
        defaultDepositAccountId: v.defaultDepositAccountId || null,
        reserveCents: v.reserveCents,
        createdById: userId,
      },
    });
    await tx.unit.createMany({
      data: v.units.map((u) => ({
        organizationId: orgId,
        propertyId: p.id,
        name: u.name,
        beds: u.beds ?? null,
        bathsTenths: u.bathsTenths ?? null,
        sqft: u.sqft ?? null,
        marketRentCents: u.marketRentCents,
        amenities: u.amenities,
        createdById: userId,
      })),
    });
    if (v.owners.length) {
      await tx.propertyOwnership.createMany({
        data: v.owners.map((o) => ({
          organizationId: orgId,
          propertyId: p.id,
          ownerId: o.ownerId,
          percentBps: o.percentBps,
          agreementStart: dateOrNull(o.agreementStart),
          agreementEnd: dateOrNull(o.agreementEnd),
          createdById: userId,
        })),
      });
    }
    return p;
  });
  await audit(db, { action: "property.created", entityType: "Property", entityId: property.id, after: { ...v } });
  return { id: property.id };
}

export async function updateProperty(db: ScopedDb, id: string, raw: PropertyEditInput): Promise<void> {
  const v = propertyEditSchema.parse(raw);
  const before = await db.property.findFirst({ where: { id } });
  if (!before) throw new UserFacingError("Property not found");
  await assertPortfolio(db, v.portfolioId);
  await assertBankAccount(db, v.defaultOperatingAccountId, "defaultOperatingAccountId");
  await assertBankAccount(db, v.defaultDepositAccountId, "defaultDepositAccountId");
  const after = await db.property.update({
    where: { id },
    data: {
      name: v.name,
      portfolioId: v.portfolioId || null,
      addressLine1: v.address.addressLine1,
      addressLine2: v.address.addressLine2 || null,
      city: v.address.city,
      state: v.address.state,
      postalCode: v.address.postalCode,
      yearBuilt: v.yearBuilt ?? null,
      defaultOperatingAccountId: v.defaultOperatingAccountId || null,
      defaultDepositAccountId: v.defaultDepositAccountId || null,
      reserveCents: v.reserveCents,
    },
  });
  await audit(db, { action: "property.updated", entityType: "Property", entityId: id, before, after });
}

export async function archiveProperty(db: ScopedDb, id: string, archived: boolean): Promise<void> {
  if (archived && (await db.lease.count({ where: { propertyId: id, status: { in: ["ACTIVE", "EVICTION", "DRAFT"] } } }))) {
    throw new UserFacingError("This property has active or draft leases. End them before archiving the property.");
  }
  const res = await db.property.updateMany({
    where: { id, deletedAt: archived ? null : { not: null } },
    data: { deletedAt: archived ? new Date() : null },
  });
  if (res.count === 0) throw new UserFacingError("Property not found");
  await audit(db, { action: archived ? "property.archived" : "property.restored", entityType: "Property", entityId: id });
}

// ─── Units ────────────────────────────────────────────────────────────────

export async function createUnit(db: ScopedDb, propertyId: string, raw: UnitInput): Promise<{ id: string }> {
  const v = unitInputSchema.parse(raw);
  const property = await db.property.findFirst({ where: { id: propertyId }, include: { units: { where: { deletedAt: null } } } });
  if (!property) throw new UserFacingError("Choose a property", { propertyId: "Choose a property" });
  if (PROPERTY_TYPE_META[property.type].singleUnit && property.units.length >= 1) {
    throw new UserFacingError("A single-family property has exactly one unit. Change the property type to add more.", { propertyId: "Single-family properties have one unit" });
  }
  if (property.units.some((u) => u.name.trim().toLowerCase() === v.name.trim().toLowerCase())) {
    throw new UserFacingError("That unit name is already used at this property", { name: "Already used at this property" });
  }
  const unit = await db.unit.create({
    data: {
      organizationId: db.ctx.orgId,
      propertyId,
      name: v.name,
      beds: v.beds ?? null,
      bathsTenths: v.bathsTenths ?? null,
      sqft: v.sqft ?? null,
      marketRentCents: v.marketRentCents,
      amenities: v.amenities,
      createdById: db.ctx.userId,
    },
  });
  await audit(db, { action: "unit.created", entityType: "Unit", entityId: unit.id, after: unit });
  return { id: unit.id };
}

export async function updateUnit(db: ScopedDb, id: string, raw: UnitInput): Promise<void> {
  const v = unitInputSchema.parse(raw);
  const before = await db.unit.findFirst({ where: { id } });
  if (!before) throw new UserFacingError("Unit not found");
  const clash = await db.unit.findFirst({ where: { propertyId: before.propertyId, id: { not: id }, name: { equals: v.name, mode: "insensitive" } } });
  if (clash) throw new UserFacingError("That unit name is already used at this property", { name: "Already used at this property" });
  const after = await db.unit.update({
    where: { id },
    data: { name: v.name, beds: v.beds ?? null, bathsTenths: v.bathsTenths ?? null, sqft: v.sqft ?? null, marketRentCents: v.marketRentCents, amenities: v.amenities },
  });
  await audit(db, { action: "unit.updated", entityType: "Unit", entityId: id, before, after });
}

export async function archiveUnit(db: ScopedDb, id: string, archived: boolean): Promise<void> {
  const unit = await db.unit.findFirst({ where: { id, deletedAt: archived ? null : { not: null } } });
  if (!unit) throw new UserFacingError("Unit not found");
  if (archived) {
    if (await db.leaseUnit.count({ where: { unitId: id, lease: { status: { in: ["ACTIVE", "EVICTION", "DRAFT"] } } } })) {
      throw new UserFacingError("This unit has an active or draft lease. End it before archiving the unit.");
    }
    const remaining = await db.unit.count({ where: { propertyId: unit.propertyId, id: { not: id } } });
    if (remaining === 0) throw new UserFacingError("A property needs at least one unit. Archive the property instead.");
  }
  await db.unit.update({ where: { id }, data: { deletedAt: archived ? new Date() : null } });
  await audit(db, { action: archived ? "unit.archived" : "unit.restored", entityType: "Unit", entityId: id });
}

// ─── Owners & ownership ───────────────────────────────────────────────────

function ownerData(v: z.output<typeof ownerSchema>) {
  return {
    kind: v.kind,
    firstName: v.kind === "PERSON" ? v.firstName || null : null,
    lastName: v.kind === "PERSON" ? v.lastName || null : null,
    companyName: v.companyName || null,
    email: v.email ? v.email.toLowerCase() : null,
    phone: v.phone || null,
    addressLine1: v.addressLine1 || null,
    city: v.city || null,
    state: v.state || null,
    postalCode: v.postalCode || null,
    // Only the last 4 digits of a tax id are ever stored.
    taxInfo: { taxIdType: v.taxIdType || null, taxIdLast4: v.taxIdLast4 || null, send1099: v.send1099 },
  };
}

export async function createOwner(db: ScopedDb, raw: OwnerInput): Promise<{ id: string }> {
  const v = ownerSchema.parse(raw);
  const owner = await db.owner.create({ data: { organizationId: db.ctx.orgId, ...ownerData(v), createdById: db.ctx.userId } });
  await audit(db, { action: "owner.created", entityType: "Owner", entityId: owner.id, after: owner });
  return { id: owner.id };
}

export async function updateOwner(db: ScopedDb, id: string, raw: OwnerInput): Promise<void> {
  const v = ownerSchema.parse(raw);
  const before = await db.owner.findFirst({ where: { id } });
  if (!before) throw new UserFacingError("Owner not found");
  const after = await db.owner.update({ where: { id }, data: ownerData(v) });
  await audit(db, { action: "owner.updated", entityType: "Owner", entityId: id, before, after });
}

export async function archiveOwner(db: ScopedDb, id: string, archived: boolean): Promise<void> {
  if (archived) {
    const active = await db.propertyOwnership.count({ where: { ownerId: id, property: { deletedAt: null } } });
    if (active > 0) throw new UserFacingError("This owner still owns properties. Remove their ownership first.");
  }
  const res = await db.owner.updateMany({ where: { id, deletedAt: archived ? null : { not: null } }, data: { deletedAt: archived ? new Date() : null } });
  if (res.count === 0) throw new UserFacingError("Owner not found");
  await audit(db, { action: archived ? "owner.archived" : "owner.restored", entityType: "Owner", entityId: id });
}

const ownershipListSchema = z.array(ownershipInputSchema).superRefine((list, ctx) => {
  const total = list.reduce((s, o) => s + o.percentBps, 0);
  if (list.length && total !== 10_000) ctx.addIssue({ code: "custom", message: `Ownership must total 100% (currently ${formatPercentBps(total)})` });
  if (new Set(list.map((o) => o.ownerId)).size !== list.length) ctx.addIssue({ code: "custom", message: "Each owner can be added once" });
});

/** Replace a property's ownership split atomically. */
export async function setOwnerships(db: ScopedDb, propertyId: string, raw: z.input<typeof ownershipListSchema>): Promise<void> {
  const list = ownershipListSchema.parse(raw);
  const property = await db.property.findFirst({ where: { id: propertyId } });
  if (!property) throw new UserFacingError("Property not found");
  if (list.length) {
    const found = await db.owner.count({ where: { id: { in: list.map((o) => o.ownerId) } } });
    if (found !== list.length) throw new UserFacingError("One of the owners no longer exists");
  }
  const before = await db.propertyOwnership.findMany({ where: { propertyId } });
  await db.tx(async (tx) => {
    await tx.propertyOwnership.deleteMany({ where: { propertyId } });
    if (list.length) {
      await tx.propertyOwnership.createMany({
        data: list.map((o) => ({
          organizationId: db.ctx.orgId,
          propertyId,
          ownerId: o.ownerId,
          percentBps: o.percentBps,
          agreementStart: dateOrNull(o.agreementStart),
          agreementEnd: dateOrNull(o.agreementEnd),
          createdById: db.ctx.userId,
        })),
      });
    }
  });
  await audit(db, { action: "property.ownership_updated", entityType: "Property", entityId: propertyId, before, after: list });
}

// ─── Portfolios ───────────────────────────────────────────────────────────

const portfolioSchema = z.object({ name: z.string().trim().min(2, "Name the portfolio").max(80), description: z.string().trim().max(300).optional() });

export async function savePortfolio(db: ScopedDb, id: string | null, raw: z.input<typeof portfolioSchema>): Promise<{ id: string }> {
  const v = portfolioSchema.parse(raw);
  const clash = await db.portfolio.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new UserFacingError("A portfolio with that name exists", { name: "Already exists" });
  if (id) {
    await db.portfolio.update({ where: { id }, data: { name: v.name, description: v.description || null } });
    await audit(db, { action: "portfolio.updated", entityType: "Portfolio", entityId: id, after: v });
    return { id };
  }
  const p = await db.portfolio.create({ data: { organizationId: db.ctx.orgId, name: v.name, description: v.description || null, createdById: db.ctx.userId } });
  await audit(db, { action: "portfolio.created", entityType: "Portfolio", entityId: p.id, after: v });
  return { id: p.id };
}

export async function deletePortfolio(db: ScopedDb, id: string): Promise<void> {
  await db.tx(async (tx) => {
    await tx.property.updateMany({ where: { portfolioId: id }, data: { portfolioId: null } });
    await tx.portfolio.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  await audit(db, { action: "portfolio.deleted", entityType: "Portfolio", entityId: id });
}
