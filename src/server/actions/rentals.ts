"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type AppContext } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { canAccessProperty } from "@/server/permissions";
import * as svc from "@/server/rentals/service";
import type { OwnerInput, PropertyEditInput, PropertyWizardInput, UnitInput } from "@/lib/rentals";

function guardProperty(ctx: AppContext, propertyId: string) {
  if (!canAccessProperty(ctx.membership.propertyScope, propertyId)) throw new UserFacingError("You don't have access to that property.");
}

function refresh() {
  revalidatePath("/app", "layout");
}

export async function createProperty(input: PropertyWizardInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    if (ctx.membership.propertyScope.length) throw new UserFacingError("Your access is limited to specific properties, so you can't create new ones.");
    const r = await svc.createPropertyFromWizard(ctx.db, input);
    // In the background: look up the county land record, then (if there's no photo yet) add a free
    // aerial picture as the main picture. The property page shows them when ready.
    void (async () => {
      await import("@/server/rentals/land-records").then((m) => m.refreshLandRecord(ctx.db, r.id)).catch(() => undefined);
      if (process.env.PLACE_PHOTOS === "off" || process.env.PARCELS_PROVIDER === "mock" || process.env.PARCELS_PROVIDER === "off") return;
      const prop = await ctx.db.property.findFirst({ where: { id: r.id }, select: { photos: true } });
      if (prop && !prop.photos.length) await import("@/server/images/place-photos").then((m) => m.addAerialPhoto(ctx.db, r.id, { cover: true })).catch(() => undefined);
    })();
    refresh();
    return r;
  }, "Property created");
}

export async function editProperty(id: string, input: PropertyEditInput): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    guardProperty(ctx, id);
    await svc.updateProperty(ctx.db, id, input);
    refresh();
  }, "Property saved");
}

export async function setPropertyArchived(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "delete");
    guardProperty(ctx, id);
    await svc.archiveProperty(ctx.db, id, archived);
    refresh();
  }, archived ? "Property archived" : "Property restored");
}

export async function addUnit(propertyId: string, input: UnitInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    guardProperty(ctx, propertyId);
    const r = await svc.createUnit(ctx.db, propertyId, input);
    refresh();
    return r;
  }, "Unit added");
}

export async function editUnit(id: string, input: UnitInput): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    const unit = await ctx.db.unit.findFirst({ where: { id } });
    if (!unit) throw new UserFacingError("Unit not found");
    guardProperty(ctx, unit.propertyId);
    await svc.updateUnit(ctx.db, id, input);
    refresh();
  }, "Unit saved");
}

export async function setUnitArchived(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "delete");
    const unit = await ctx.db.unit.findFirst({ where: { id, deletedAt: undefined } });
    if (!unit) throw new UserFacingError("Unit not found");
    guardProperty(ctx, unit.propertyId);
    await svc.archiveUnit(ctx.db, id, archived);
    refresh();
  }, archived ? "Unit archived" : "Unit restored");
}

export async function createOwner(input: OwnerInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    const r = await svc.createOwner(ctx.db, input);
    refresh();
    return r;
  }, "Owner created");
}

export async function editOwner(id: string, input: OwnerInput): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    await svc.updateOwner(ctx.db, id, input);
    refresh();
  }, "Owner saved");
}

export async function setOwnerArchived(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "delete");
    await svc.archiveOwner(ctx.db, id, archived);
    refresh();
  }, archived ? "Owner archived" : "Owner restored");
}

export async function saveOwnerships(
  propertyId: string,
  list: { ownerId: string; percentBps: number; agreementStart?: string | null; agreementEnd?: string | null }[],
): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    guardProperty(ctx, propertyId);
    await svc.setOwnerships(ctx.db, propertyId, list);
    refresh();
  }, "Ownership updated");
}

export async function savePortfolio(id: string | null, input: { name: string; description?: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    const r = await svc.savePortfolio(ctx.db, id, input);
    refresh();
    return r;
  }, "Portfolio saved");
}

export async function deletePortfolio(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "delete");
    await svc.deletePortfolio(ctx.db, id);
    refresh();
  }, "Portfolio deleted");
}

/** Members with "Users & roles" edit access can limit a member to specific properties. */
export async function setMemberPropertyScope(membershipId: string, propertyIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "edit");
    const m = await ctx.db.membership.findFirst({ where: { id: membershipId } });
    if (!m) throw new UserFacingError("Member not found");
    const valid = propertyIds.length ? await ctx.db.property.count({ where: { id: { in: propertyIds } } }) : 0;
    if (valid !== propertyIds.length) throw new UserFacingError("One of the properties no longer exists");
    await ctx.db.membership.update({ where: { id: m.id }, data: { propertyScope: propertyIds } });
    const { audit } = await import("@/server/audit");
    await audit(ctx.db, { action: "member.property_scope_changed", entityType: "Membership", entityId: m.id, before: m.propertyScope, after: propertyIds });
    revalidatePath("/app/settings/users");
  }, "Property access updated");
}

/** Look up (or refresh) a property's land record from the county / parcel provider. */
export async function refreshLandRecordAction(propertyId: string): Promise<ActionResult<{ status: string; message: string | null }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    if (!canAccessProperty(ctx.membership.propertyScope, propertyId)) throw new UserFacingError("You don't have access to that property.");
    const { refreshLandRecord } = await import("@/server/rentals/land-records");
    const r = await refreshLandRecord(ctx.db, propertyId);
    revalidatePath(`/app/rentals/${propertyId}`);
    return { status: r.status, message: r.error };
  });
}

export async function saveManualLandRecordAction(propertyId: string, v: import("@/server/rentals/land-records").ManualLandRecord): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    if (!canAccessProperty(ctx.membership.propertyScope, propertyId)) throw new UserFacingError("You don't have access to that property.");
    const { saveManualLandRecord } = await import("@/server/rentals/land-records");
    await saveManualLandRecord(ctx.db, propertyId, v);
    revalidatePath(`/app/rentals/${propertyId}`);
  }, "Land record saved");
}
