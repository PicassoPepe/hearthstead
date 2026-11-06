"use server";

import { revalidatePath } from "next/cache";
import { companySchema, type CompanyInput } from "@/lib/schemas";
import { requirePermission } from "@/server/context";
import { runAction, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";

export async function updateCompany(input: CompanyInput): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const data = companySchema.parse(input);
    const before = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    const after = await ctx.db.organization.update({
      where: { id: ctx.org.id },
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        addressLine1: data.addressLine1 || null,
        city: data.city || null,
        state: data.state || null,
        postalCode: data.postalCode || null,
        timezone: data.timezone,
        brandColor: data.brandColor,
      },
    });
    await audit(ctx.db, { action: "organization.updated", entityType: "Organization", entityId: ctx.org.id, before, after });
    revalidatePath("/app", "layout");
  }, "Company details saved");
}
