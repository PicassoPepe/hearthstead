"use server";
import { cookieOptions } from "@/lib/cookies";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action-result";
import { adminDb } from "@/server/db";
import { ORG_COOKIE, requirePermission } from "@/server/context";
import { ensureSandbox } from "@/server/platform/integrations";

/**
 * "Explore with sample data": builds (or reuses) this company's sandbox — a separate, clearly
 * labeled organization full of sample properties, leases, tasks and a listing — and switches to it.
 * Your real books stay empty; switch back any time from the account menu.
 */
export async function exploreSampleData(): Promise<ActionResult<{ orgId: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const orgId = await ensureSandbox(ctx.db, false);
    // Make sure the current user can open it (the sandbox is created with them as admin).
    const m = await adminDb.membership.findFirst({ where: { organizationId: orgId, userId: ctx.user.id, deletedAt: null } });
    if (!m) {
      const role = await adminDb.role.findFirstOrThrow({ where: { organizationId: orgId, key: "ADMIN" } });
      await adminDb.membership.create({ data: { organizationId: orgId, userId: ctx.user.id, roleId: role.id, status: "ACTIVE", acceptedAt: new Date(), createdById: ctx.user.id } });
    }
    (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
    await adminDb.user.update({ where: { id: ctx.user.id }, data: { lastOrgId: orgId } });
    revalidatePath("/app", "layout");
    return { orgId };
  }, "Sample data ready — you're in your sandbox");
}
