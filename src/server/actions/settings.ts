"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { isSettingKey, type Scope } from "@/server/settings/registry";
import { clearSetting, setSetting, SettingValidationError } from "@/server/settings/service";
import { audit } from "@/server/audit";

function scopeIdFor(scope: Scope, orgId: string, scopeId?: string): string {
  if (scope === "ORG") return orgId;
  if (!scopeId) throw new UserFacingError("Missing scope id");
  return scopeId;
}

export async function saveSetting(input: { key: string; scope: Scope; scopeId?: string; value: unknown }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    if (!isSettingKey(input.key)) throw new UserFacingError("Unknown setting");
    const scopeId = scopeIdFor(input.scope, ctx.org.id, input.scopeId);
    try {
      const { before, after } = await setSetting(ctx.db, input.key, input.scope, scopeId, input.value);
      await audit(ctx.db, { action: "setting.updated", entityType: "Setting", entityId: `${input.scope}:${scopeId}:${input.key}`, before, after });
    } catch (e) {
      if (e instanceof SettingValidationError) throw new UserFacingError(e.message);
      throw e;
    }
    revalidatePath("/app/settings", "layout");
  }, "Setting saved");
}

export async function clearSettingOverride(input: { key: string; scope: Scope; scopeId?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    if (!isSettingKey(input.key)) throw new UserFacingError("Unknown setting");
    const scopeId = scopeIdFor(input.scope, ctx.org.id, input.scopeId);
    await clearSetting(ctx.db, input.key, input.scope, scopeId);
    await audit(ctx.db, { action: "setting.override_removed", entityType: "Setting", entityId: `${input.scope}:${scopeId}:${input.key}` });
    revalidatePath("/app/settings", "layout");
  }, "Now inheriting");
}
