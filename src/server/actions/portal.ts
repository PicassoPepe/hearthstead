"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPortalContext, PORTAL_LEASE_COOKIE, PREVIEW_COOKIE, type PortalContext } from "@/server/portal/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as P from "@/server/payments/service";
import { storeAttachment } from "@/server/records/service";
import { audit } from "@/server/audit";
import { isoDate } from "@/lib/leasing";
import { parseISODate } from "@/lib/dates";
import { parseMoney } from "@/lib/money";

/** Every portal write: signed-in tenant, not a staff preview, and only their own lease. */
async function writer(leaseId?: string): Promise<PortalContext & { leaseId: string }> {
  const ctx = await getPortalContext();
  if (!ctx) throw new UserFacingError("Please sign in again.");
  if (ctx.preview) throw new UserFacingError("This is a read-only preview of the tenant portal.");
  const id = leaseId ?? ctx.lease?.id;
  if (!id || !ctx.leases.some((l) => l.id === id)) throw new UserFacingError("Lease not found");
  return { ...ctx, leaseId: id };
}

const refresh = () => revalidatePath("/portal", "layout");

export async function selectLease(leaseId: string): Promise<void> {
  const ctx = await getPortalContext();
  if (ctx?.leases.some((l) => l.id === leaseId)) (await cookies()).set(PORTAL_LEASE_COOKIE, leaseId, { httpOnly: true, sameSite: "lax", path: "/portal" });
  refresh();
}

const cardSchema = z.object({
  number: z.string().regex(/^[\d ]{12,23}$/, "Enter the card number"),
  exp: z.string().regex(/^(0[1-9]|1[0-2])\s?\/\s?(\d{2})$/, "Use MM/YY"),
  cvc: z.string().regex(/^\d{3,4}$/, "3 or 4 digits"),
});
const bankSchema = z.object({
  holderName: z.string().trim().min(2, "Enter the account holder's name"),
  routingNumber: z.string().regex(/^\d{9}$/, "Routing numbers have 9 digits"),
  accountNumber: z.string().regex(/^\d{4,17}$/, "Check the account number"),
});

export async function addCard(raw: z.input<typeof cardSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await writer();
    const v = cardSchema.parse(raw);
    const [mm, yy] = v.exp.split("/").map((x) => Number(x.trim()));
    const pm = await P.savePaymentMethod(ctx.db, ctx.tenant.id, { type: "CARD", card: { number: v.number.replace(/\s/g, ""), expMonth: mm!, expYear: 2000 + yy!, cvc: v.cvc } });
    refresh();
    return { id: pm.id };
  }, "Card saved");
}

/** Bank verification. In mock mode the routing/account numbers are checked instantly (like
 *  Financial Connections test mode); with Stripe the client returns a Financial Connections id. */
export async function addBank(raw: z.input<typeof bankSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await writer();
    const v = bankSchema.parse(raw);
    const pm = await P.savePaymentMethod(ctx.db, ctx.tenant.id, { type: "ACH", bank: v });
    refresh();
    return { id: pm.id };
  }, "Bank account verified");
}

export async function removeMethod(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await writer();
    await P.removePaymentMethod(ctx.db, ctx.tenant.id, id);
    refresh();
  }, "Payment method removed");
}

export async function payNow(input: { paymentMethodId: string; amountCents: number; idempotencyKey: string }): Promise<ActionResult<{ id: string; status: string }>> {
  return runAction(async () => {
    const ctx = await writer();
    const pi = await P.startPayment(ctx.db, { leaseId: ctx.leaseId, tenantId: ctx.tenant.id, paymentMethodId: input.paymentMethodId, amountCents: input.amountCents, origin: "PORTAL", idempotencyKey: `portal:${input.idempotencyKey}`, today: ctx.today });
    if (pi.status === "FAILED") throw new UserFacingError(pi.failureReason ?? "The payment didn't go through.");
    refresh();
    revalidatePath("/app", "layout");
    return { id: pi.id, status: pi.status };
  });
}

const autopaySchema = z.object({
  paymentMethodId: z.string().min(1, "Choose a payment method"),
  dayOfMonth: z.number().int().min(1).max(28),
  amountMode: z.enum(["FULL_BALANCE", "FIXED"]),
  fixedAmount: z.string().optional(),
});

export async function saveAutopay(raw: z.input<typeof autopaySchema>): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await writer();
    const v = autopaySchema.parse(raw);
    const method = await ctx.db.paymentMethod.findFirst({ where: { id: v.paymentMethodId, tenantId: ctx.tenant.id } });
    if (!method || !method.verified) throw new UserFacingError("Choose a verified payment method", { paymentMethodId: "Choose a payment method" });
    const fixed = v.amountMode === "FIXED" ? parseMoney(v.fixedAmount ?? "") : null;
    if (v.amountMode === "FIXED" && (!fixed || fixed <= 0)) throw new UserFacingError("Enter the amount", { fixedAmount: "Enter the amount" });
    const data = { paymentMethodId: method.id, dayOfMonth: v.dayOfMonth, amountMode: v.amountMode, fixedCents: fixed, active: true };
    await ctx.db.autopay.upsert({
      where: { leaseId_tenantId: { leaseId: ctx.leaseId, tenantId: ctx.tenant.id } },
      create: { organizationId: ctx.org.id, leaseId: ctx.leaseId, tenantId: ctx.tenant.id, ...data, createdById: ctx.user.id },
      update: data,
    });
    await audit(ctx.db, { action: "autopay.saved", entityType: "Lease", entityId: ctx.leaseId, after: data });
    refresh();
  }, "Autopay is on");
}

export async function stopAutopay(): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await writer();
    await ctx.db.autopay.updateMany({ where: { leaseId: ctx.leaseId, tenantId: ctx.tenant.id }, data: { active: false } });
    await audit(ctx.db, { action: "autopay.stopped", entityType: "Lease", entityId: ctx.leaseId });
    refresh();
  }, "Autopay turned off");
}

const insuranceSchema = z.object({ carrier: z.string().trim().min(2, "Enter the insurance company"), policyNumber: z.string().trim().min(3, "Enter the policy number"), effectiveDate: isoDate, expiresOn: isoDate, liability: z.string().optional() });

export async function uploadInsurance(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await writer();
    const v = insuranceSchema.parse(Object.fromEntries(["carrier", "policyNumber", "effectiveDate", "expiresOn", "liability"].map((k) => [k, String(form.get(k) ?? "")])));
    if (v.expiresOn <= v.effectiveDate) throw new UserFacingError("The policy must end after it starts", { expiresOn: "After the start date" });
    const file = form.get("file");
    let attachmentId: string | null = null;
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      attachmentId = (await storeAttachment(ctx.db, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }, { type: "Lease", id: ctx.leaseId }, "Insurance")).id;
    }
    await ctx.db.insurancePolicy.create({
      data: {
        organizationId: ctx.org.id, leaseId: ctx.leaseId, tenantId: ctx.tenant.id, carrier: v.carrier, policyNumber: v.policyNumber,
        liabilityCents: v.liability ? parseMoney(v.liability) : null, effectiveDate: parseISODate(v.effectiveDate), expiresOn: parseISODate(v.expiresOn),
        attachmentId, source: "UPLOADED", status: "PENDING_REVIEW", createdById: ctx.user.id,
      },
    });
    await audit(ctx.db, { action: "insurance.uploaded", entityType: "Lease", entityId: ctx.leaseId, after: { carrier: v.carrier, policyNumber: v.policyNumber } });
    refresh();
  }, "Proof of insurance submitted");
}

export async function exitPreview(): Promise<void> {
  const jar = await cookies();
  const tenantId = jar.get(PREVIEW_COOKIE)?.value;
  jar.delete(PREVIEW_COOKIE);
  redirect(tenantId ? `/app/people/tenants/${tenantId}` : "/app/overview");
}
