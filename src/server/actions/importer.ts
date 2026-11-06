"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { runImport } from "@/server/importer/service";
import { orgToday } from "@/server/leasing/queries";
import type { ImportResult } from "@/lib/importer";

const input = z.object({
  kind: z.enum(["properties", "owners", "leases"]),
  records: z.array(z.record(z.string(), z.string().max(500))).max(5000),
  commit: z.boolean(),
});

export async function importRecords(raw: z.input<typeof input>): Promise<ActionResult<ImportResult>> {
  return runAction(async () => {
    const v = input.parse(raw);
    const ctx = await requirePermission(v.kind === "owners" ? "people" : v.kind === "leases" ? "leasing" : "rentals", "edit");
    if (v.kind === "properties" && ctx.membership.propertyScope.length) throw new UserFacingError("Your access is limited to specific properties, so you can't import properties.");
    const r = await runImport(ctx.db, v.kind, v.records, v.commit, await orgToday(ctx));
    if (v.commit && r.ok) revalidatePath("/app", "layout");
    return r;
  });
}
