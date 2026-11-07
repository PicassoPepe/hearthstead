"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOwnerPortalContext } from "@/server/portal/owner-context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { receivePortalMessage } from "@/server/comms/service";
import { createTask } from "@/server/maintenance/tasks";

async function owner() {
  const ctx = await getOwnerPortalContext();
  if (!ctx) throw new UserFacingError("Please sign in again.");
  return ctx;
}

export async function sendOwnerMessage(body: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await owner();
    await receivePortalMessage(ctx.db, { ownerId: ctx.owner.id }, z.string().max(2000, "Keep it under 2,000 characters").parse(body), { userId: ctx.user.id, name: ctx.owner.name });
    revalidatePath("/portal/owner/messages");
  }, "Message sent");
}

const requestSchema = z.object({
  propertyId: z.string().min(1, "Choose a property"),
  title: z.string().trim().min(3, "Add a short summary").max(120),
  description: z.string().trim().max(2000).optional(),
});

/** Owners can raise requests (e.g. "replace the roof") for their own properties only. */
export async function submitOwnerRequest(raw: z.input<typeof requestSchema>): Promise<ActionResult<{ number: number }>> {
  return runAction(async () => {
    const ctx = await owner();
    const v = requestSchema.parse(raw);
    if (!ctx.propertyIds.includes(v.propertyId)) throw new UserFacingError("Choose one of your properties", { propertyId: "Not your property" });
    const t = await createTask(ctx.db, { type: "OWNER_REQUEST", title: v.title, description: v.description, propertyId: v.propertyId }, { userId: ctx.user.id, name: ctx.owner.name, kind: "OWNER" });
    await ctx.db.task.update({ where: { id: t.id }, data: { ownerId: ctx.owner.id } });
    revalidatePath("/portal/owner/requests");
    return { number: t.number };
  }, "Request sent");
}
