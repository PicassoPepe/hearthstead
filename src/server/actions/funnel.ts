"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";
import * as L from "@/server/funnel/listings";
import * as A from "@/server/funnel/applications";
import * as E from "@/server/funnel/esign";
import * as R from "@/server/funnel/renewals";
import { isoDate } from "@/lib/leasing";

/** Staff actions for the leasing funnel: listings, prospects, showings, applications, e-sign, renewals, templates. */
const me = (ctx: { user: { name: string | null; email: string } }) => ({ name: ctx.user.name ?? ctx.user.email, email: ctx.user.email });

const listingSchema = z.object({
  unitId: z.string().min(1, "Choose a unit"), title: z.string().max(120), description: z.string().max(5000), rentCents: z.number().int().positive("Enter the asking rent"),
  depositCents: z.number().int().min(0), availableOn: z.union([z.literal(""), isoDate]).nullish(), leaseTermMonths: z.number().int().min(1).max(36), petPolicy: z.string().max(120), syndicate: z.boolean(),
});
export async function saveListingAction(id: string | null, raw: z.input<typeof listingSchema>, publish = false): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    const l = await L.saveListing(ctx.db, id, listingSchema.parse(raw));
    if (publish) await L.setListingStatus(ctx.db, l.id, "PUBLISHED");
    revalidatePath("/app/rentals/listings");
    return { id: l.id };
  }, publish ? "Listing published" : "Listing saved");
}

export async function setListingStatusAction(id: string, status: "PUBLISHED" | "UNLISTED"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    await L.setListingStatus(ctx.db, id, status);
    revalidatePath("/app/rentals/listings");
  }, status === "PUBLISHED" ? "Listing published" : "Listing unlisted");
}

export async function describeListingAction(unitId: string, rentCents: number, petPolicy: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    return L.describeListing(ctx.db, unitId, rentCents, petPolicy);
  });
}

const prospectSchema = z.object({ firstName: z.string().max(60), lastName: z.string().max(60), email: z.string().email("Enter a valid email").or(z.literal("")).optional(), phone: z.string().max(30).optional(), source: z.string().max(20).optional(), listingId: z.string().nullish(), notes: z.string().max(1000).optional() });
export async function createProspectAction(raw: z.input<typeof prospectSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    const v = prospectSchema.parse(raw);
    const p = await L.createProspect(ctx.db, { ...v, email: v.email || null, phone: v.phone || null });
    revalidatePath("/app/people/prospects");
    return { id: p.id };
  }, "Prospect added");
}

export async function setProspectStatusAction(id: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await ctx.db.prospect.updateMany({ where: { id }, data: { status: z.enum(["NEW", "CONTACTED", "TOURED", "APPLIED", "LEASED", "LOST"]).parse(status) } });
    revalidatePath("/app/people/prospects");
  }, "Prospect updated");
}

export async function scheduleShowingAction(raw: { listingId: string; prospectId: string; startsAt: string; durationMin?: number; notes?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await L.scheduleShowing(ctx.db, { ...raw, agentUserId: ctx.user.id });
    revalidatePath("/app/leasing/showings");
  }, "Showing scheduled");
}

export async function setShowingStatusAction(id: string, status: "COMPLETED" | "NO_SHOW" | "CANCELED"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await L.setShowingStatus(ctx.db, id, status);
    revalidatePath("/app/leasing/showings");
  }, "Showing updated");
}

export async function approveApplicationAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await A.approveApplication(ctx.db, id);
    revalidatePath("/app/leasing/applications", "layout");
  }, "Application approved — applicant notified");
}

export async function declineApplicationAction(id: string, reasons: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await A.declineApplication(ctx.db, id, reasons);
    revalidatePath("/app/leasing/applications", "layout");
  }, "Application declined — adverse action notice sent");
}

export async function sendLeaseForSignatureAction(leaseId: string, templateId: string | null): Promise<ActionResult<{ missing: string[] }>> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    const r = await E.sendLeaseForSignature(ctx.db, leaseId, templateId, me(ctx));
    revalidatePath(`/app/leasing/${leaseId}`);
    return { missing: r.missing };
  }, "Sent for e-signature");
}

export async function voidSignatureAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await E.voidSignatureRequest(ctx.db, id);
    revalidatePath("/app/leasing", "layout");
  }, "Signature request voided");
}

export async function sendRenewalAction(raw: { leaseId: string; newRentCents: number; termMonths: number; expiresInDays?: number; message?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await R.sendRenewalOffer(ctx.db, raw, me(ctx));
    revalidatePath("/app/leasing/renewals");
  }, "Renewal offer sent for signature");
}

export async function setRenewalStatusAction(id: string, status: "DECLINED" | "WITHDRAWN" | "ACCEPTED"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    if (status === "ACCEPTED") await R.acceptRenewal(ctx.db, id, "staff");
    else await R.setRenewalStatus(ctx.db, id, status);
    revalidatePath("/app/leasing/renewals");
  }, status === "ACCEPTED" ? "Renewal accepted — new lease created" : "Renewal updated");
}

const templateSchema = z.object({ name: z.string().trim().min(2, "Name it").max(80), kind: z.enum(["LEASE", "RENEWAL", "NOTICE", "ADVERSE_ACTION", "OTHER"]), body: z.string().min(10, "Write the template").max(50_000) });
export async function saveTemplateAction(id: string | null, raw: z.input<typeof templateSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const v = templateSchema.parse(raw);
    const t = id ? await ctx.db.documentTemplate.update({ where: { id }, data: v }) : await ctx.db.documentTemplate.create({ data: { organizationId: ctx.org.id, createdById: ctx.user.id, ...v } });
    await audit(ctx.db, { action: id ? "template.updated" : "template.created", entityType: "DocumentTemplate", entityId: t.id });
    revalidatePath("/app/settings/templates");
    return { id: t.id };
  }, "Template saved");
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const t = await ctx.db.documentTemplate.findFirst({ where: { id } });
    if (!t) throw new UserFacingError("Not found");
    await ctx.db.documentTemplate.update({ where: { id }, data: { deletedAt: new Date() } });
    revalidatePath("/app/settings/templates");
  }, "Template deleted");
}
