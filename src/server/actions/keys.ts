"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/context";
import { canAccessProperty } from "@/server/permissions";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as K from "@/server/rentals/keys";

const done = () => revalidatePath("/app", "layout");

async function guard(id: string | null, propertyId?: string) {
  const ctx = await requirePermission("rentals", "edit");
  const pid = propertyId ?? (id ? (await ctx.db.keyItem.findFirst({ where: { id } }))?.propertyId : undefined);
  if (!pid || !canAccessProperty(ctx.membership.propertyScope, pid)) throw new UserFacingError("You don't have access to that property.");
  return ctx;
}

export async function saveKeyItemAction(id: string | null, v: K.KeyInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await guard(id, v.propertyId);
    const r = await K.saveKeyItem(ctx.db, id, v);
    done();
    return r;
  }, id ? "Saved" : "Added");
}

export async function assignKeyItemAction(id: string, v: { leaseId: string; date: string; billFee: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await guard(id);
    await K.assignKeyItem(ctx.db, id, v);
    done();
  }, "Assigned");
}

export async function returnKeyItemAction(id: string, v: { date: string; lost?: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await guard(id);
    await K.returnKeyItem(ctx.db, id, v);
    done();
  }, v.lost ? "Marked lost" : "Returned");
}

export async function setKeyStatusAction(id: string, status: "AVAILABLE" | "RETIRED"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await guard(id);
    await K.setKeyStatus(ctx.db, id, status);
    done();
  }, status === "RETIRED" ? "Retired" : "Available again");
}
