"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type AppContext } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { isSettingKey, type Scope } from "@/server/settings/registry";
import { clearSetting, setSetting, SettingValidationError } from "@/server/settings/service";
import { canAccessProperty } from "@/server/permissions";
import { audit } from "@/server/audit";

/**
 * Who may change a setting depends on the scope:
 *   ORG      → Company settings: edit
 *   PROPERTY → Rentals: edit, plus access to that property
 *   LEASE    → Leasing: edit, plus access to the lease's property
 * The scope id is always verified to belong to the caller's organization.
 */
async function authorize(scope: Scope, scopeId?: string): Promise<{ ctx: AppContext; id: string }> {
  if (scope === "ORG") {
    const ctx = await requirePermission("settings", "edit");
    return { ctx, id: ctx.org.id };
  }
  if (!scopeId) throw new UserFacingError("Missing scope id");
  if (scope === "PROPERTY") {
    const ctx = await requirePermission("rentals", "edit");
    if (!canAccessProperty(ctx.membership.propertyScope, scopeId)) throw new UserFacingError("You don't have access to that property.");
    if (!(await ctx.db.property.findFirst({ where: { id: scopeId }, select: { id: true } }))) throw new UserFacingError("Property not found");
    return { ctx, id: scopeId };
  }
  const ctx = await requirePermission("leasing", "edit");
  const lease = await ctx.db.lease.findFirst({ where: { id: scopeId }, select: { propertyId: true } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (!canAccessProperty(ctx.membership.propertyScope, lease.propertyId)) throw new UserFacingError("You don't have access to that lease.");
  return { ctx, id: scopeId };
}

export async function saveSetting(input: { key: string; scope: Scope; scopeId?: string; value: unknown }): Promise<ActionResult> {
  return runAction(async () => {
    if (!isSettingKey(input.key)) throw new UserFacingError("Unknown setting");
    const { ctx, id } = await authorize(input.scope, input.scopeId);
    try {
      const { before, after } = await setSetting(ctx.db, input.key, input.scope, id, input.value);
      await audit(ctx.db, { action: "setting.updated", entityType: "Setting", entityId: `${input.scope}:${id}:${input.key}`, before, after });
    } catch (e) {
      if (e instanceof SettingValidationError) throw new UserFacingError(e.message);
      throw e;
    }
    revalidatePath("/app", "layout");
  }, "Setting saved");
}

export async function clearSettingOverride(input: { key: string; scope: Scope; scopeId?: string }): Promise<ActionResult> {
  return runAction(async () => {
    if (!isSettingKey(input.key)) throw new UserFacingError("Unknown setting");
    const { ctx, id } = await authorize(input.scope, input.scopeId);
    await clearSetting(ctx.db, input.key, input.scope, id);
    await audit(ctx.db, { action: "setting.override_removed", entityType: "Setting", entityId: `${input.scope}:${id}:${input.key}` });
    revalidatePath("/app", "layout");
  }, "Now inheriting");
}
