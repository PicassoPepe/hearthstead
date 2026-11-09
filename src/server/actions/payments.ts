"use server";

import { cookieOptions } from "@/lib/cookies";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PaymentStatus } from "@prisma/client";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as P from "@/server/payments/service";
import { inviteTenantToPortal } from "@/server/portal/invite";
import { PREVIEW_COOKIE } from "@/server/portal/context";
import { orgToday } from "@/server/leasing/queries";
import { audit } from "@/server/audit";
import { getPaymentsProvider } from "@/adapters/payments";

export async function connectPayments(): Promise<ActionResult<{ onboardingUrl?: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    const r = await P.connectProcessor(ctx.db, org.name, org.email);
    revalidatePath("/app/settings/payments");
    return { onboardingUrl: r.onboardingUrl };
  }, "Payments connected");
}

export async function inviteToPortal(tenantIds: string[]): Promise<ActionResult<{ sent: number; skipped: string[] }>> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    let sent = 0;
    const skipped: string[] = [];
    for (const id of tenantIds.slice(0, 200)) {
      try {
        await inviteTenantToPortal(ctx.db, id, ctx.org.name);
        sent++;
      } catch (e) {
        if (e instanceof UserFacingError) skipped.push(e.message);
        else throw e;
      }
    }
    if (sent === 0 && skipped.length) throw new UserFacingError(skipped[0]!);
    revalidatePath("/app", "layout");
    return { sent, skipped };
  });
}

/** Staff "Preview portal as" — read-only (see PortalContext.preview). */
export async function previewPortalAs(tenantId: string): Promise<void> {
  const ctx = await requirePermission("people", "view");
  const t = await ctx.db.tenant.findFirst({ where: { id: tenantId } });
  if (!t) throw new UserFacingError("Tenant not found");
  (await cookies()).set(PREVIEW_COOKIE, tenantId, cookieOptions({ maxAge: 60 * 60 }));
  await audit(ctx.db, { action: "tenant.portal_previewed", entityType: "Tenant", entityId: tenantId });
  redirect("/portal/tenant");
}

/** Mock processor only: let staff advance a payment for demos and testing. */
export async function simulatePayment(intentId: string, to: PaymentStatus): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    if (getPaymentsProvider().name !== "mock") throw new UserFacingError("Only available with the mock processor.");
    const before = await ctx.db.paymentIntent.findFirst({ where: { id: intentId } });
    if (!before) throw new UserFacingError("Payment not found");
    await P.transition(ctx.db, intentId, to, to === "FAILED" ? "Simulated ACH return (R01)" : "Simulated by staff", await orgToday(ctx));
    await audit(ctx.db, { action: "payment.simulated", entityType: "PaymentIntent", entityId: intentId, before: { status: before.status }, after: { status: to } });
    revalidatePath("/app", "layout");
  }, "Payment updated");
}

export async function settleMockPayments(): Promise<ActionResult<{ settled: number; failed: number; paidOut: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await P.advanceMockPayments(ctx.db, await orgToday(ctx));
    revalidatePath("/app", "layout");
    return r;
  });
}

export async function verifyInsurance(policyId: string, status: "VERIFIED" | "PENDING_REVIEW"): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    const p = await ctx.db.insurancePolicy.findFirst({ where: { id: policyId } });
    if (!p) throw new UserFacingError("Policy not found");
    await ctx.db.insurancePolicy.update({ where: { id: policyId }, data: { status } });
    await audit(ctx.db, { action: "insurance.reviewed", entityType: "InsurancePolicy", entityId: policyId, after: { status } });
    revalidatePath("/app", "layout");
  }, status === "VERIFIED" ? "Insurance verified" : "Marked for review");
}
