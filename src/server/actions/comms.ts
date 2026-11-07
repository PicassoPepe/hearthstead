"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, type ActionResult } from "@/server/action-result";
import * as C from "@/server/comms/service";
import * as A from "@/server/comms/announcements";
import { inviteOwnerToPortal } from "@/server/portal/invite";

/** Staff communications actions: inbox, announcements, AI drafting, owner invites. */
const author = (ctx: { user: { id: string; name: string | null; email: string } }) => ({ userId: ctx.user.id, name: ctx.user.name ?? ctx.user.email });
const channel = z.enum(["PORTAL", "SMS", "EMAIL", "NOTE"]);

export async function sendMessageAction(conversationId: string, raw: { body: string; channel: string; aiDrafted?: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    const v = z.object({ body: z.string(), channel, aiDrafted: z.boolean().optional() }).parse(raw);
    await C.sendMessage(ctx.db, conversationId, { ...v, author: author(ctx) });
    revalidatePath("/app/communications");
  }, raw.channel === "NOTE" ? "Note added" : "Message sent");
}

export async function startConversationAction(raw: { party: string; body: string; channel: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    const v = z.object({ party: z.string().regex(/^(T|O|V):.+$/, "Choose who to message"), body: z.string(), channel }).parse(raw);
    const [kind, id] = [v.party.slice(0, 1), v.party.slice(2)];
    const party = kind === "T" ? { tenantId: id } : kind === "O" ? { ownerId: id } : { vendorId: id };
    const conv = await C.startConversation(ctx.db, party, { body: v.body, channel: v.channel, author: author(ctx) });
    revalidatePath("/app/communications");
    return { id: conv.id };
  }, "Message sent");
}

export async function markReadAction(conversationId: string): Promise<void> {
  const ctx = await requirePermission("communications", "view");
  await C.markConversationRead(ctx.db, conversationId);
}

export async function setConversationStatusAction(conversationId: string, status: "OPEN" | "CLOSED"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    await ctx.db.conversation.updateMany({ where: { id: conversationId }, data: { status } });
    revalidatePath("/app/communications");
  }, status === "CLOSED" ? "Conversation closed" : "Conversation reopened");
}

export async function draftReplyAction(conversationId: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    return C.draftReply(ctx.db, conversationId, ctx.user.name ?? "The team");
  });
}

export async function improveTextAction(text: string, purpose: "announcement" | "message"): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    return C.improveText(ctx.db, z.string().max(4000).parse(text), purpose);
  });
}

const announcementSchema = z.object({
  title: z.string().max(120),
  body: z.string().max(4000),
  audience: z.object({ type: z.enum(A.AUDIENCE_TYPES), propertyIds: z.array(z.string()).max(500) }),
  channels: z.array(z.enum(["PORTAL", "EMAIL", "SMS"])),
  scheduledFor: z.string().nullish(),
});

export async function saveAnnouncementAction(id: string | null, raw: z.input<typeof announcementSchema>, mode: "draft" | "schedule" | "send"): Promise<ActionResult<{ id: string; sent: number; failed: number; skipped: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    const r = await A.saveAnnouncement(ctx.db, id, announcementSchema.parse(raw), mode);
    revalidatePath("/app/communications", "layout");
    return r;
  });
}

export async function previewAudienceAction(raw: { type: string; propertyIds: string[] }): Promise<ActionResult<{ count: number; email: number; sms: number; sample: string[] }>> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "view");
    const v = announcementSchema.shape.audience.parse(raw);
    const r = await A.resolveAudience(ctx.db, v);
    return { count: r.length, email: r.filter((x) => x.email).length, sms: r.filter((x) => x.phone).length, sample: r.slice(0, 5).map((x) => x.name) };
  });
}

export async function cancelAnnouncementAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("communications", "edit");
    await A.cancelAnnouncement(ctx.db, id);
    revalidatePath("/app/communications", "layout");
  }, "Announcement canceled");
}

export async function inviteOwnerAction(ownerId: string): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    const r = await inviteOwnerToPortal(ctx.db, ownerId, ctx.org.name);
    revalidatePath(`/app/people/owners/${ownerId}`);
    return r;
  }, "Owner portal invite sent");
}
