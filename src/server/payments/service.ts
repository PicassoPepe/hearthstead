import { createDeposit } from "@/server/accounting/banking";
import { randomUUID } from "node:crypto";
import type { PaymentStatus } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getPaymentsProvider, PaymentDeclinedError } from "@/adapters/payments";
import { getSettings } from "@/server/settings/service";
import { addDays, diffDays, periodOf, toISODate } from "@/lib/dates";
import { convenienceFee, TRANSITIONS, type MethodType } from "@/lib/payments";
import { applicationOrder } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";

/**
 * Online payments. The ledger is updated as soon as money is in flight:
 *   card  → SUCCEEDED immediately → payment posted
 *   ACH   → PROCESSING → payment posted (balance reflects it) → SUCCEEDED → PAID_OUT
 *   a later FAILED (ACH return) reverses the ledger payment through the returned-payment path.
 * The convenience fee is collected by the processor and never touches the tenant ledger.
 */

const SETTLE_DAYS = 2;
const PAYOUT_DAYS = 2;

export async function portalSettings(db: ScopedDb, lease: { id: string; propertyId: string }) {
  const s = await getSettings(
    db,
    ["tenantPortal.enabled", "tenantPortal.allowOnlinePayments", "tenantPortal.allowPartialPayments", "tenantPortal.showLedger", "tenantPortal.allowRequests", "tenantPortal.requireInsurance", "payments.passThroughCardFee", "payments.passThroughAchFee"],
    { orgId: db.ctx.orgId, propertyId: lease.propertyId, leaseId: lease.id },
  );
  return {
    enabled: s["tenantPortal.enabled"].value,
    allowOnlinePayments: s["tenantPortal.allowOnlinePayments"].value,
    allowPartialPayments: s["tenantPortal.allowPartialPayments"].value,
    showLedger: s["tenantPortal.showLedger"].value,
    allowRequests: s["tenantPortal.allowRequests"].value,
    requireInsurance: s["tenantPortal.requireInsurance"].value,
    passThroughCard: s["payments.passThroughCardFee"].value,
    passThroughAch: s["payments.passThroughAchFee"].value,
  };
}

async function addEvent(db: ScopedDb, intentId: string, status: PaymentStatus, note?: string) {
  await db.paymentEvent.create({ data: { organizationId: db.ctx.orgId, paymentIntentId: intentId, status, note: note ?? null } });
}

export async function startPayment(
  db: ScopedDb,
  input: { leaseId: string; tenantId: string; paymentMethodId: string; amountCents: number; origin: "PORTAL" | "AUTOPAY" | "STAFF"; idempotencyKey?: string; today: Date },
) {
  if (input.idempotencyKey) {
    const dup = await db.paymentIntent.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
    if (dup) return dup;
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Enter an amount" });
  const lease = await db.lease.findFirst({ where: { id: input.leaseId, tenants: { some: { tenantId: input.tenantId } } } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (!["ACTIVE", "EVICTION", "ENDED"].includes(lease.status)) throw new UserFacingError("This lease isn't accepting payments.");
  const method = await db.paymentMethod.findFirst({ where: { id: input.paymentMethodId, tenantId: input.tenantId } });
  if (!method) throw new UserFacingError("Choose a payment method", { paymentMethodId: "Choose a payment method" });
  if (!method.verified) throw new UserFacingError("Verify this bank account before paying with it.");
  const account = await db.processorAccount.findFirst();
  if (!account || !account.chargesEnabled) throw new UserFacingError("Online payments aren't set up for this property yet. Please contact your property manager.");
  const settings = await portalSettings(db, lease);
  if (!settings.allowOnlinePayments) throw new UserFacingError("Online payments are turned off for this lease.");
  const { balanceCents } = await db.tx((tx) => M.leaseBalance(tx, lease.id));
  if (!settings.allowPartialPayments && input.origin !== "STAFF" && balanceCents > 0 && input.amountCents < balanceCents) {
    throw new UserFacingError(`Partial payments aren't allowed. Pay the full balance of $${(balanceCents / 100).toFixed(2)}.`, { amountCents: "Pay the full balance" });
  }
  const type = method.type as MethodType;
  const fee = convenienceFee(type, input.amountCents, type === "CARD" ? settings.passThroughCard : settings.passThroughAch);
  const key = input.idempotencyKey ?? randomUUID();

  let result;
  try {
    result = await getPaymentsProvider().charge({
      connectedAccount: account.externalId, methodType: type, methodRef: method.providerRef,
      totalCents: input.amountCents + fee, feeCents: fee, idempotencyKey: key, description: `Rent payment — lease ${lease.id}`,
    });
  } catch (e) {
    if (e instanceof PaymentDeclinedError) throw new UserFacingError(e.message);
    throw e;
  }

  const intent = await db.paymentIntent.create({
    data: {
      organizationId: db.ctx.orgId, leaseId: lease.id, tenantId: input.tenantId, paymentMethodId: method.id, methodType: type,
      amountCents: input.amountCents, feeCents: fee, status: "INITIATED", provider: getPaymentsProvider().name, providerRef: result.providerRef,
      origin: input.origin, idempotencyKey: key, initiatedOn: input.today, createdById: db.ctx.userId,
    },
  });
  await addEvent(db, intent.id, "INITIATED", `${type === "CARD" ? `${method.brand ?? "Card"}` : (method.bankName ?? "Bank")} ••${method.last4}`);
  await audit(db, { action: "payment.initiated", entityType: "PaymentIntent", entityId: intent.id, actorType: input.origin === "AUTOPAY" ? "SYSTEM" : "USER", after: { amountCents: input.amountCents, feeCents: fee, type } });
  return transition(db, intent.id, result.status, result.failureReason, input.today);
}

/** Apply a status change (from the provider, a webhook, the mock settler, or staff). Idempotent. */
export async function transition(db: ScopedDb, intentId: string, to: PaymentStatus, note: string | undefined, today: Date) {
  const intent = await db.paymentIntent.findFirst({ where: { id: intentId } });
  if (!intent) throw new UserFacingError("Payment not found");
  if (intent.status === to) return intent;
  if (!TRANSITIONS[intent.status]?.includes(to)) return intent; // out-of-order or duplicate event

  const lease = await db.lease.findFirstOrThrow({ where: { id: intent.leaseId } });
  const order = await applicationOrder(db, { propertyId: lease.propertyId, leaseId: lease.id });
  const a = { orgId: db.ctx.orgId, userId: db.ctx.userId };
  const updated = await db.tx(async (tx) => {
    let leaseTransactionId = intent.leaseTransactionId;
    if ((to === "PROCESSING" || to === "SUCCEEDED") && !leaseTransactionId) {
      const p = await M.receivePayment(tx, a, {
        leaseId: intent.leaseId, amountCents: intent.amountCents, date: today, method: intent.methodType,
        reference: intent.providerRef.slice(-8), memo: `Online payment (${intent.methodType === "CARD" ? "card" : "ACH"})${intent.origin === "AUTOPAY" ? " — autopay" : ""}`,
        paymentIntentId: intent.id, order,
      });
      leaseTransactionId = p.transaction.id;
    }
    if (to === "FAILED" && leaseTransactionId) {
      await M.returnPayment(tx, a, { paymentId: leaseTransactionId, date: today, nsfFeeCents: 0, reason: note ?? "Payment failed", order });
    }
    return tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: to, leaseTransactionId, failureReason: to === "FAILED" ? (note ?? "Payment failed") : intent.failureReason,
        expectedPayoutDate: to === "SUCCEEDED" ? addDays(today, PAYOUT_DAYS) : intent.expectedPayoutDate,
      },
    });
  }, { timeout: 30_000 });
  await addEvent(db, intent.id, to, note);
  // A processor payout lands in the bank: move the payment out of Undeposited Funds automatically.
  if (to === "PAID_OUT" && updated.leaseTransactionId) {
    const t = await db.leaseTransaction.findFirst({ where: { id: updated.leaseTransactionId } });
    if (t && !t.depositId && !t.voidedAt) {
      const bankId = lease.propertyId ? (await db.property.findFirst({ where: { id: lease.propertyId } }))?.defaultOperatingAccountId : null;
      const bank = bankId ?? (await db.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
      await createDeposit(db, { bankAccountId: bank, date: toISODate(today), paymentIds: [t.id], memo: `Processor payout — ${intent.providerRef.slice(-8)}` }).catch(() => undefined);
    }
  }
  // A card payment that succeeds immediately also passes through PROCESSING in the timeline.
  return updated;
}

/** Mock processor: settle ACH after 2 days and pay out 2 days after success. Real providers use webhooks. */
export async function advanceMockPayments(db: ScopedDb, today: Date): Promise<{ settled: number; failed: number; paidOut: number }> {
  const provider = getPaymentsProvider();
  const out = { settled: 0, failed: 0, paidOut: 0 };
  if (!provider.settle) return out;
  const pending = await db.paymentIntent.findMany({ where: { provider: "mock", status: "PROCESSING" } });
  for (const p of pending) {
    if (diffDays(p.initiatedOn, today) < SETTLE_DAYS) continue;
    const r = await provider.settle(p.providerRef);
    await transition(db, p.id, r, r === "FAILED" ? "ACH return R01 — insufficient funds" : undefined, today);
    if (r === "FAILED") out.failed++;
    else out.settled++;
  }
  const done = await db.paymentIntent.findMany({ where: { provider: "mock", status: "SUCCEEDED", expectedPayoutDate: { lte: today } } });
  for (const p of done) {
    await transition(db, p.id, "PAID_OUT", "Deposited to your bank account", today);
    out.paidOut++;
  }
  return out;
}

/**
 * Autopay: on or after the chosen day each month, pay the balance (or a fixed amount) with the
 * saved method. One attempt per autopay per month (unique AutopayRun), so it's safe to re-run.
 */
export async function runAutopay(db: ScopedDb, today: Date): Promise<{ attempted: number; skipped: number; failed: number }> {
  const out = { attempted: 0, skipped: 0, failed: 0 };
  const autopays = await db.autopay.findMany({ where: { active: true } });
  const period = periodOf(today);
  for (const ap of autopays) {
    if (today.getUTCDate() < ap.dayOfMonth) continue;
    const claimed = await db.autopayRun.createMany({ data: [{ organizationId: db.ctx.orgId, autopayId: ap.id, period }], skipDuplicates: true });
    if (claimed.count === 0) continue;
    const { balanceCents } = await db.tx((tx) => M.leaseBalance(tx, ap.leaseId));
    const amount = ap.amountMode === "FIXED" ? (ap.fixedCents ?? 0) : balanceCents;
    if (amount <= 0) {
      await db.autopayRun.update({ where: { autopayId_period: { autopayId: ap.id, period } }, data: { note: "Nothing due" } });
      out.skipped++;
      continue;
    }
    try {
      const pi = await startPayment(db, { leaseId: ap.leaseId, tenantId: ap.tenantId, paymentMethodId: ap.paymentMethodId, amountCents: amount, origin: "AUTOPAY", idempotencyKey: `autopay:${ap.id}:${period}`, today });
      await db.autopayRun.update({ where: { autopayId_period: { autopayId: ap.id, period } }, data: { paymentIntentId: pi.id, note: pi.status } });
      if (pi.status === "FAILED") out.failed++;
      else out.attempted++;
    } catch (e) {
      await db.autopayRun.update({ where: { autopayId_period: { autopayId: ap.id, period } }, data: { note: e instanceof Error ? e.message.slice(0, 200) : "Failed" } });
      out.failed++;
    }
  }
  return out;
}

// ─── Payment methods & processor account ──────────────────────────────────

export async function savePaymentMethod(
  db: ScopedDb,
  tenantId: string,
  input: { type: "CARD"; card: { number: string; expMonth: number; expYear: number; cvc: string } } | { type: "ACH"; bank: { routingNumber: string; accountNumber: string; holderName: string } },
) {
  const provider = getPaymentsProvider();
  let saved;
  try {
    saved = input.type === "CARD" ? await provider.addCard(input.card) : await provider.verifyBank(input.bank);
  } catch (e) {
    if (e instanceof PaymentDeclinedError) throw new UserFacingError(e.message);
    throw e;
  }
  const hasDefault = await db.paymentMethod.count({ where: { tenantId, isDefault: true } });
  const pm = await db.paymentMethod.create({
    data: {
      organizationId: db.ctx.orgId, tenantId, type: saved.type, brand: saved.brand ?? null, bankName: saved.bankName ?? null, last4: saved.last4,
      expMonth: saved.expMonth ?? null, expYear: saved.expYear ?? null, verified: saved.verified, isDefault: hasDefault === 0, providerRef: saved.providerRef, createdById: db.ctx.userId,
    },
  });
  await audit(db, { action: "payment_method.added", entityType: "Tenant", entityId: tenantId, after: { type: pm.type, last4: pm.last4 } });
  return pm;
}

export async function removePaymentMethod(db: ScopedDb, tenantId: string, id: string) {
  const pm = await db.paymentMethod.findFirst({ where: { id, tenantId } });
  if (!pm) throw new UserFacingError("Payment method not found");
  if (await db.autopay.count({ where: { paymentMethodId: id, active: true } })) throw new UserFacingError("This method is used for autopay. Turn off autopay or switch methods first.");
  await db.paymentMethod.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
}

export async function connectProcessor(db: ScopedDb, orgName: string, email: string | null) {
  const existing = await db.processorAccount.findFirst();
  const provider = getPaymentsProvider();
  const r = existing ? await provider.refreshAccount(existing.externalId) : await provider.createAccount(orgName, email);
  const data = { provider: provider.name, externalId: r.externalId, status: r.status, chargesEnabled: r.chargesEnabled, payoutsEnabled: r.payoutsEnabled, payoutBankMask: r.payoutBankMask ?? null };
  const acct = existing
    ? await db.processorAccount.update({ where: { id: existing.id }, data })
    : await db.processorAccount.create({ data: { organizationId: db.ctx.orgId, ...data, createdById: db.ctx.userId } });
  await audit(db, { action: "processor.connected", entityType: "ProcessorAccount", entityId: acct.id, after: data });
  return { account: acct, onboardingUrl: r.onboardingUrl };
}
