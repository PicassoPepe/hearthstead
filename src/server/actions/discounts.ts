"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requirePermission, type AppContext } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { canAccessProperty } from "@/server/permissions";
import { clientIp } from "@/server/auth/rate-limit";
import { getPortalContext } from "@/server/portal/context";
import * as D from "@/server/discounts/service";

const ip = async () => { const v = clientIp(await headers()); return v === "local" ? null : v; };
const actor = async (ctx: AppContext): Promise<D.DiscountActor> => ({ orgId: ctx.org.id, userId: ctx.user.id, name: ctx.user.name ?? ctx.user.email, ip: await ip(), permissions: ctx.permissions });
const refresh = () => { revalidatePath("/app", "layout"); revalidatePath("/portal", "layout"); };

async function guardLease(ctx: AppContext, leaseId: string | undefined) {
  if (!leaseId) return;
  const lease = await ctx.db.lease.findFirst({ where: { id: leaseId }, select: { propertyId: true } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (!canAccessProperty(ctx.membership.propertyScope, lease.propertyId)) throw new UserFacingError("You don't have access to that property.");
}

export async function createDiscountAction(input: D.DiscountInput): Promise<ActionResult<{ id: string; pending: boolean; appliedCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "edit");
    await guardLease(ctx, input.leaseId);
    if (input.propertyId && !canAccessProperty(ctx.membership.propertyScope, input.propertyId)) throw new UserFacingError("You don't have access to that property.");
    const r = await D.createDiscount(ctx.db, await actor(ctx), input);
    refresh();
    return { id: r.discount.id, pending: r.pending, appliedCents: r.appliedCents };
  });
}

export async function approveDiscountAction(id: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "delete");
    const n = await D.approveDiscount(ctx.db, await actor(ctx), id);
    refresh();
    return n;
  }, "Discount approved");
}

export async function rejectDiscountAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "delete");
    await D.rejectDiscount(ctx.db, await actor(ctx), id, reason);
    refresh();
  }, "Discount turned down");
}

export async function revokeDiscountAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "delete");
    await D.revokeDiscount(ctx.db, await actor(ctx), id, reason);
    refresh();
  }, "Discount stopped — what it already took off stays");
}

export async function saveDiscountPolicyAction(v: { reasons: string[]; overCents: number; overPercentBps: number }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "delete");
    await D.saveDiscountPolicy(ctx.db, await actor(ctx), v);
    refresh();
  }, "Discount settings saved");
}

/** Staff enter a code on a tenant's behalf. */
export async function staffRedeemCodeAction(leaseId: string, code: string): Promise<ActionResult<{ description: string; appliedCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "edit");
    await guardLease(ctx, leaseId);
    const r = await D.redeemCode(ctx.db, await actor(ctx), { code, leaseId, tenantId: null });
    refresh();
    return { description: r.description, appliedCents: r.appliedCents };
  }, "Code applied");
}

/** Tenant portal: "Have a discount code?" */
export async function portalRedeemCodeAction(code: string): Promise<ActionResult<{ description: string; appliedCents: number }>> {
  return runAction(async () => {
    const ctx = await getPortalContext();
    if (!ctx) throw new UserFacingError("Please sign in again.");
    if (ctx.preview) throw new UserFacingError("This is a read-only preview of the tenant portal.");
    if (!ctx.lease) throw new UserFacingError("Lease not found");
    const r = await D.redeemCode(ctx.db, { orgId: ctx.org.id, userId: ctx.user.id, name: ctx.tenant.name, ip: await ip(), permissions: {} }, { code, leaseId: ctx.lease.id, tenantId: ctx.tenant.id });
    refresh();
    return { description: r.description, appliedCents: r.appliedCents };
  }, "Code applied — your discount is on your account");
}

/** For the "one charge" picker: the lease's recent charges and how much is still discountable. */
export async function leaseChargesForDiscountAction(leaseId: string): Promise<ActionResult<{ id: string; label: string; amountCents: number }[]>> {
  return runAction(async () => {
    const ctx = await requirePermission("discounts", "edit");
    await guardLease(ctx, leaseId);
    const rows = await ctx.db.leaseTransaction.findMany({ where: { leaseId, type: "CHARGE", voidedAt: null, chargeKind: { notIn: ["DEPOSIT", "OPENING_BALANCE"] } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 24 });
    return rows.map((c) => ({ id: c.id, label: `${c.date.toISOString().slice(0, 10)} · ${c.memo ?? "Charge"}`, amountCents: c.amountCents }));
  });
}
