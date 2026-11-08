"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, type AppContext } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { canAccessProperty } from "@/server/permissions";
import { audit } from "@/server/audit";
import { parseISODate, todayIn } from "@/lib/dates";
import { isoDate, type LeaseWizardInput, type NewTenantInput } from "@/lib/leasing";
import * as L from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import { createTenant as svcCreateTenant, updateTenant as svcUpdateTenant } from "@/server/leasing/tenants";
import { runNightly } from "@/server/jobs/nightly";
import { adminDb } from "@/server/db";

async function orgToday(ctx: AppContext): Promise<Date> {
  const org = await adminDb.organization.findUnique({ where: { id: ctx.org.id }, select: { timezone: true } });
  return todayIn(org?.timezone ?? "America/New_York");
}

async function guardLease(ctx: AppContext, leaseId: string) {
  const lease = await ctx.db.lease.findFirst({ where: { id: leaseId } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (!canAccessProperty(ctx.membership.propertyScope, lease.propertyId)) throw new UserFacingError("You don't have access to that property.");
  return lease;
}

const refresh = () => revalidatePath("/app", "layout");

export async function createLease(input: LeaseWizardInput, applicationId?: string): Promise<ActionResult<{ id: string; esignError?: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    if (!canAccessProperty(ctx.membership.propertyScope, input.propertyId)) throw new UserFacingError("You don't have access to that property.");
    const r = await L.createLease(ctx.db, input, await orgToday(ctx));
    if (input.portalInvite && (input.status ?? "ACTIVE") === "ACTIVE") {
      const { inviteTenantToPortal } = await import("@/server/portal/invite");
      const tenants = await ctx.db.leaseTenant.findMany({ where: { leaseId: r.id }, include: { tenant: true } });
      for (const t of tenants) if (t.tenant.email && t.role !== "COSIGNER") await inviteTenantToPortal(ctx.db, t.tenantId, ctx.org.name).catch(() => undefined);
    }
    let esignError: string | undefined;
    if (input.documents === "ESIGN") {
      const { sendLeaseForSignature } = await import("@/server/funnel/esign");
      try {
        await sendLeaseForSignature(ctx.db, r.id, null, { name: ctx.user.name ?? ctx.user.email, email: ctx.user.email });
      } catch (e) {
        // The lease is created either way; tell the user why signing didn't go out.
        if (e instanceof UserFacingError) esignError = e.message;
        else throw e;
      }
    }
    // Leasing funnel: link the approved application, and take the unit's listing down.
    if (applicationId) await ctx.db.application.updateMany({ where: { id: applicationId, status: "APPROVED" }, data: { leaseId: r.id } });
    const { autoDelist } = await import("@/server/funnel/listings");
    await autoDelist(ctx.db);
    refresh();
    return { ...r, esignError };
  }, "Lease created");
}

export async function activateLease(leaseId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    await L.activateLease(ctx.db, leaseId, await orgToday(ctx));
    refresh();
  }, "Lease activated");
}

export async function moveOut(leaseId: string, input: { moveOutDate: string; reason: string; prorate: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    isoDate.parse(input.moveOutDate);
    await L.endLease(ctx.db, leaseId, input, await orgToday(ctx));
    refresh();
  }, "Move-out recorded");
}

export async function setEviction(leaseId: string, on: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    await L.setEviction(ctx.db, leaseId, on);
    refresh();
  }, on ? "Lease moved to eviction" : "Eviction cancelled");
}

const moneySchema = z.object({
  kind: z.enum(["CHARGE", "PAYMENT", "CREDIT", "DEPOSIT", "REFUND_DEPOSIT", "REFUND_PREPAID"]),
  leaseId: z.string().min(1),
  amountCents: z.number().int(),
  date: isoDate,
  dueDate: z.union([z.literal(""), isoDate]).optional(),
  accountId: z.string().optional(),
  depositAccountId: z.string().optional(),
  method: z.string().max(20).optional(),
  reference: z.string().trim().max(60).optional(),
  memo: z.string().trim().max(200).optional(),
});
export type MoneyInput = z.input<typeof moneySchema>;

const LABEL: Record<MoneyInput["kind"], string> = {
  CHARGE: "Charge posted", PAYMENT: "Payment received", CREDIT: "Credit posted", DEPOSIT: "Deposit recorded",
  REFUND_DEPOSIT: "Deposit refunded", REFUND_PREPAID: "Credit balance refunded",
};

/** One action for every money form on a lease (charge, payment, credit, deposit, refunds). */
export async function postLeaseMoney(raw: MoneyInput): Promise<ActionResult<{ id: string }>> {
  const v = moneySchema.parse(raw);
  return runAction(async () => {
    const ctx = await requirePermission(v.kind === "CHARGE" || v.kind === "CREDIT" ? "leasing" : "accounting", "edit");
    const lease = await guardLease(ctx, v.leaseId);
    if (lease.status === "DRAFT") throw new UserFacingError("Activate the lease before posting money to it.");
    const order = await L.applicationOrder(ctx.db, { propertyId: lease.propertyId, leaseId: lease.id });
    const a = { orgId: ctx.org.id, userId: ctx.user.id };
    const date = parseISODate(v.date);
    const t = await ctx.db.tx(async (tx) => {
      switch (v.kind) {
        case "CHARGE":
          if (!v.accountId) throw new UserFacingError("Choose an account", { accountId: "Choose an account" });
          return M.postCharge(tx, a, { leaseId: v.leaseId, accountId: v.accountId, amountCents: v.amountCents, date, dueDate: v.dueDate ? parseISODate(v.dueDate) : date, memo: v.memo || null, order });
        case "PAYMENT":
          return (await M.receivePayment(tx, a, { leaseId: v.leaseId, amountCents: v.amountCents, date, method: v.method, reference: v.reference || null, memo: v.memo || null, depositAccountId: v.depositAccountId || null, order })).transaction;
        case "CREDIT":
          if (!v.accountId) throw new UserFacingError("Choose an account", { accountId: "Choose an account" });
          return M.postCredit(tx, a, { leaseId: v.leaseId, amountCents: v.amountCents, date, accountId: v.accountId, memo: v.memo || null, order });
        case "DEPOSIT":
          return M.recordDeposit(tx, a, { leaseId: v.leaseId, amountCents: v.amountCents, date, method: v.method, reference: v.reference || null });
        case "REFUND_DEPOSIT":
          return M.refund(tx, a, { leaseId: v.leaseId, kind: "DEPOSIT", amountCents: v.amountCents, date, memo: v.memo || null });
        case "REFUND_PREPAID":
          return M.refund(tx, a, { leaseId: v.leaseId, kind: "PREPAID", amountCents: v.amountCents, date, bankAccountId: v.depositAccountId || null, memo: v.memo || null });
      }
    });
    await audit(ctx.db, { action: `lease.${v.kind.toLowerCase()}`, entityType: "Lease", entityId: v.leaseId, after: { ...v, transactionId: t.id } });
    refresh();
    return { id: t.id };
  }, LABEL[v.kind]);
}

export async function voidLeaseTransaction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const t = await ctx.db.leaseTransaction.findFirst({ where: { id } });
    if (!t) throw new UserFacingError("Transaction not found");
    const lease = await guardLease(ctx, t.leaseId);
    const order = await L.applicationOrder(ctx.db, { propertyId: lease.propertyId, leaseId: lease.id });
    const before = { ...t };
    await ctx.db.tx((tx) => M.voidTransaction(tx, { orgId: ctx.org.id, userId: ctx.user.id }, { id, date: parseISODate(new Date().toISOString().slice(0, 10)), reason, order }));
    await audit(ctx.db, { action: "lease_transaction.voided", entityType: "LeaseTransaction", entityId: id, before, after: { voidReason: reason } });
    refresh();
  }, "Transaction voided");
}

export async function returnPayment(id: string, input: { date: string; nsfFeeCents: number; reason: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const t = await ctx.db.leaseTransaction.findFirst({ where: { id } });
    if (!t) throw new UserFacingError("Payment not found");
    const lease = await guardLease(ctx, t.leaseId);
    const order = await L.applicationOrder(ctx.db, { propertyId: lease.propertyId, leaseId: lease.id });
    await ctx.db.tx((tx) => M.returnPayment(tx, { orgId: ctx.org.id, userId: ctx.user.id }, { paymentId: id, date: parseISODate(input.date), nsfFeeCents: input.nsfFeeCents, reason: input.reason, order }));
    await audit(ctx.db, { action: "lease_transaction.returned", entityType: "LeaseTransaction", entityId: id, after: input });
    refresh();
  }, "Payment marked as returned");
}

export async function createTenant(input: NewTenantInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    const r = await svcCreateTenant(ctx.db, input);
    refresh();
    return r;
  }, "Tenant created");
}

export async function updateTenant(id: string, input: NewTenantInput): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    await svcUpdateTenant(ctx.db, id, input);
    refresh();
  }, "Tenant saved");
}

/** Run the nightly job now for this org (admins; handy in demos and after imports). */
export async function runNightlyNow(): Promise<ActionResult<{ charges: number; lateFees: number; ended: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    const r = await runNightly(ctx.db, { today: await orgToday(ctx) });
    refresh();
    return { charges: r.charges, lateFees: r.lateFees, ended: r.ended };
  });
}

// ─── Recurring charges & rent increases ───────────────────────────────────

export async function addRecurringChargeAction(leaseId: string, v: { kind: "RENT" | "OTHER"; accountId: string; description: string; amountCents: number; startDate: string; endDate?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    const R = await import("@/server/leasing/recurring");
    await R.addRecurringCharge(ctx.db, leaseId, v);
    await catchUpLease(ctx, leaseId);
    refresh();
  }, "Recurring charge added");
}

export async function changeRecurringChargeAction(leaseId: string, chargeId: string, v: { amountCents: number; effectiveDate: string; description?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    const R = await import("@/server/leasing/recurring");
    if (!(await ctx.db.recurringCharge.findFirst({ where: { id: chargeId, leaseId } }))) throw new UserFacingError("Charge not found");
    await R.changeRecurringCharge(ctx.db, chargeId, v);
    await catchUpLease(ctx, leaseId);
    refresh();
  }, "Charge updated");
}

export async function endRecurringChargeAction(leaseId: string, chargeId: string, endDate: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    await guardLease(ctx, leaseId);
    const R = await import("@/server/leasing/recurring");
    if (!(await ctx.db.recurringCharge.findFirst({ where: { id: chargeId, leaseId } }))) throw new UserFacingError("Charge not found");
    await R.endRecurringCharge(ctx.db, chargeId, endDate);
    refresh();
  }, "Charge ended");
}

/** Post anything now due (e.g. a back-dated new charge) right away instead of waiting for tonight. */
async function catchUpLease(ctx: AppContext, leaseId: string) {
  const { runRecurringForLease } = await import("@/server/leasing/leases");
  const today = await orgToday(ctx);
  await ctx.db.tx((tx) => runRecurringForLease(tx, { orgId: ctx.org.id, userId: ctx.user.id }, leaseId, today), { timeout: 60_000 });
}

export async function previewRentIncrease(v: import("@/server/leasing/recurring").IncreaseInput): Promise<ActionResult<import("@/server/leasing/recurring").IncreaseLine[]>> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    const R = await import("@/server/leasing/recurring");
    const scope = ctx.membership.propertyScope;
    const allowed = scope.length ? (await ctx.db.lease.findMany({ where: { id: { in: v.leaseIds }, propertyId: { in: scope } }, select: { id: true } })).map((l) => l.id) : v.leaseIds;
    return R.previewIncrease(ctx.db, { ...v, leaseIds: allowed });
  });
}

export async function applyRentIncrease(v: import("@/server/leasing/recurring").IncreaseInput): Promise<ActionResult<{ updated: number; notified: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("leasing", "edit");
    const R = await import("@/server/leasing/recurring");
    const scope = ctx.membership.propertyScope;
    const allowed = scope.length ? (await ctx.db.lease.findMany({ where: { id: { in: v.leaseIds }, propertyId: { in: scope } }, select: { id: true } })).map((l) => l.id) : v.leaseIds;
    const r = await R.applyIncrease(ctx.db, { ...v, leaseIds: allowed });
    refresh();
    return { updated: r.updated, notified: r.notified };
  });
}
