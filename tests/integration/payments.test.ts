import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import * as P from "@/server/payments/service";
import { setSetting } from "@/server/settings/service";
import { inviteTenantToPortal } from "@/server/portal/invite";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let db: ScopedDb;
let leaseId: string;
let tenantId: string;
const today = d("2026-11-03");
const balance = () => db.tx((tx) => M.leaseBalance(tx, leaseId)).then((b) => b.balanceCents);

beforeAll(async () => {
  A = await makeOrg("PAY");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const p = await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: "Pay House", address: { addressLine1: "1 Pay St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "Main", marketRentCents: 200_000 }], owners: [] });
  const unit = await db.unit.findFirstOrThrow({ where: { propertyId: p.id } });
  leaseId = (await createLease(db, {
    propertyId: p.id, unitIds: [unit.id], termType: "MONTH_TO_MONTH", startDate: "2026-11-01", tenants: [{ newTenant: { firstName: "Pat", lastName: "Payer", email: `pat-${Date.now()}@example.com` }, role: "PRIMARY" }],
    recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 200_000 }], deposit: { amountCents: 0, handling: "NONE" },
  }, today)).id;
  tenantId = (await db.leaseTenant.findFirstOrThrow({ where: { leaseId } })).tenantId;
});
afterAll(async () => {
  const u = await admin.user.findMany({ where: { tenantLinks: { some: { organizationId: A.orgId } } } });
  await cleanup([A.orgId], [A.userId, ...u.map((x) => x.id)]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("online payments", () => {
  it("refuses payments until the processor account is connected", async () => {
    const card = await P.savePaymentMethod(db, tenantId, { type: "CARD", card: { number: "4242424242424242", expMonth: 12, expYear: 2031, cvc: "123" } });
    await expect(P.startPayment(db, { leaseId, tenantId, paymentMethodId: card.id, amountCents: 200_000, origin: "PORTAL", today })).rejects.toThrow(/aren't set up/);
    await P.connectProcessor(db, "Test Org", null);
  });

  it("card payment succeeds immediately, posts to the ledger, fee stays off the tenant ledger", async () => {
    const card = await db.paymentMethod.findFirstOrThrow({ where: { tenantId, type: "CARD" } });
    expect(await balance()).toBe(200_000);
    const pi = await P.startPayment(db, { leaseId, tenantId, paymentMethodId: card.id, amountCents: 200_000, origin: "PORTAL", idempotencyKey: "k1", today });
    expect(pi).toMatchObject({ status: "SUCCEEDED", feeCents: 5830, amountCents: 200_000 });
    expect(pi.leaseTransactionId).toBeTruthy();
    expect(await balance()).toBe(0);
    // Idempotency key: a double-click doesn't charge twice.
    const again = await P.startPayment(db, { leaseId, tenantId, paymentMethodId: card.id, amountCents: 200_000, origin: "PORTAL", idempotencyKey: "k1", today });
    expect(again.id).toBe(pi.id);
    expect(await db.paymentIntent.count()).toBe(1);
    const events = await db.paymentEvent.findMany({ where: { paymentIntentId: pi.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.status)).toEqual(["INITIATED", "SUCCEEDED"]);
  });

  it("declined card: no ledger entry", async () => {
    const bad = await P.savePaymentMethod(db, tenantId, { type: "CARD", card: { number: "4000000000000002", expMonth: 12, expYear: 2031, cvc: "123" } });
    await setSetting(db, "tenantPortal.allowPartialPayments", "ORG", A.orgId, true);
    const pi = await P.startPayment(db, { leaseId, tenantId, paymentMethodId: bad.id, amountCents: 5_000, origin: "PORTAL", today });
    expect(pi).toMatchObject({ status: "FAILED", leaseTransactionId: null, failureReason: "Your card was declined." });
  });

  it("ACH: processing posts immediately, settles after 2 days, pays out 2 days later", async () => {
    await db.tx((tx) => runRent(tx));
    const ach = await P.savePaymentMethod(db, tenantId, { type: "ACH", bank: { routingNumber: "110000000", accountNumber: "000123456789", holderName: "Pat" } });
    const pi = await P.startPayment(db, { leaseId, tenantId, paymentMethodId: ach.id, amountCents: 200_000, origin: "PORTAL", today: d("2026-12-01") });
    expect(pi.status).toBe("PROCESSING");
    expect(await balance()).toBe(0);
    expect(await P.advanceMockPayments(db, d("2026-12-01"))).toMatchObject({ settled: 0 });
    expect(await P.advanceMockPayments(db, d("2026-12-03"))).toMatchObject({ settled: 1 });
    expect(await P.advanceMockPayments(db, d("2026-12-05"))).toMatchObject({ paidOut: 1 });
    const final = await db.paymentIntent.findFirstOrThrow({ where: { id: pi.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    expect(final.events.map((e) => e.status)).toEqual(["INITIATED", "PROCESSING", "SUCCEEDED", "PAID_OUT"]);
  });

  it("ACH return reverses the ledger payment (charges reopen)", async () => {
    await db.tx((tx) => runRent(tx, "2027-01-01"));
    const nsf = await P.savePaymentMethod(db, tenantId, { type: "ACH", bank: { routingNumber: "110000000", accountNumber: "000000000002", holderName: "Pat" } });
    await P.startPayment(db, { leaseId, tenantId, paymentMethodId: nsf.id, amountCents: 200_000, origin: "PORTAL", today: d("2027-01-02") });
    expect(await balance()).toBe(0);
    expect(await P.advanceMockPayments(db, d("2027-01-05"))).toMatchObject({ failed: 1 });
    expect(await balance()).toBe(200_000);
    expect(await db.leaseTransaction.count({ where: { leaseId, type: "RETURNED_PAYMENT" } })).toBe(1);
  });

  it("partial payments follow the settings resolver", async () => {
    await setSetting(db, "tenantPortal.allowPartialPayments", "ORG", A.orgId, false);
    const card = await db.paymentMethod.findFirstOrThrow({ where: { tenantId, type: "CARD", last4: "4242" } });
    await expect(P.startPayment(db, { leaseId, tenantId, paymentMethodId: card.id, amountCents: 1_000, origin: "PORTAL", today: d("2027-01-06") })).rejects.toThrow(/Partial payments aren't allowed/);
  });

  it("autopay runs once per month on or after its day", async () => {
    const card = await db.paymentMethod.findFirstOrThrow({ where: { tenantId, type: "CARD", last4: "4242" } });
    await db.autopay.create({ data: { organizationId: A.orgId, leaseId, tenantId, paymentMethodId: card.id, dayOfMonth: 5 } });
    expect(await P.runAutopay(db, d("2027-01-04"))).toMatchObject({ attempted: 0 });
    expect(await P.runAutopay(db, d("2027-01-06"))).toMatchObject({ attempted: 1 });
    expect(await P.runAutopay(db, d("2027-01-07"))).toMatchObject({ attempted: 0 });
    expect(await balance()).toBe(0);
    const intents = await db.paymentIntent.findMany({ where: { origin: "AUTOPAY" } });
    expect(intents).toHaveLength(1);
  });

  it("portal invite links a login to the tenant and emails a sign-in link", async () => {
    const r = await inviteTenantToPortal(db, tenantId, "Test Org");
    const user = await admin.user.findUniqueOrThrow({ where: { email: r.email } });
    expect(await db.tenantUser.count({ where: { tenantId, userId: user.id } })).toBe(1);
    const mail = await admin.emailMessage.findFirstOrThrow({ where: { to: r.email }, orderBy: { createdAt: "desc" } });
    expect(mail.html).toContain("callbackUrl=%2Fportal%2Ftenant");
    expect((await db.tenant.findFirstOrThrow({ where: { id: tenantId } })).portalStatus).toBe("INVITED");
  });
});

async function runRent(tx: Parameters<Parameters<ScopedDb["tx"]>[0]>[0], until = "2026-12-01") {
  const { runRecurringForLease } = await import("@/server/leasing/leases");
  await runRecurringForLease(tx, { orgId: A.orgId, userId: A.userId }, leaseId, d(until));
}

describe("pausing a tenant's portal access", () => {
  it("blocks the portal login, keeps every record, optionally stops autopay, and can be undone", async () => {
    const { pauseTenantPortal, resumeTenantPortal } = await import("@/server/portal/invite");
    await inviteTenantToPortal(db, tenantId, "Test PAY");
    const link = await db.tenantUser.findFirstOrThrow({ where: { tenantId } });
    const pm = await db.paymentMethod.findFirstOrThrow({ where: { tenantId } });
    if (!(await db.autopay.updateMany({ where: { tenantId }, data: { active: true } })).count) await db.autopay.create({ data: { organizationId: A.orgId, leaseId, tenantId, paymentMethodId: pm.id, dayOfMonth: 1 } });
    const before = { tx: await db.leaseTransaction.count({ where: { leaseId } }), bal: await balance() };

    await expect(pauseTenantPortal(db, tenantId, { reason: "" })).rejects.toThrow(/reason/);
    const r = await pauseTenantPortal(db, tenantId, { reason: "Moved out", stopAutopay: true });
    expect(r.autopaysStopped).toBe(1);
    expect(await db.autopay.count({ where: { tenantId, active: true } })).toBe(0);
    await expect(pauseTenantPortal(db, tenantId, { reason: "Again" })).rejects.toThrow(/already paused/);
    // The login link is kept, but the portal lookup (same filter as getPortalContext) no longer finds it.
    expect(await admin.tenantUser.count({ where: { id: link.id, deletedAt: null } })).toBe(1);
    expect(await admin.tenantUser.count({ where: { userId: link.userId, deletedAt: null, tenant: { portalPausedAt: null } } })).toBe(0);
    await expect(inviteTenantToPortal(db, tenantId, "Test PAY")).rejects.toThrow(/paused/);
    // Nothing is lost.
    expect(await db.leaseTransaction.count({ where: { leaseId } })).toBe(before.tx);
    expect(await balance()).toBe(before.bal);
    expect(await db.tenant.count({ where: { id: tenantId, deletedAt: null } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "tenant.portal_paused", entityId: tenantId } })).toBe(1);

    await resumeTenantPortal(db, tenantId);
    expect(await admin.tenantUser.count({ where: { userId: link.userId, deletedAt: null, tenant: { portalPausedAt: null } } })).toBe(1);
    expect((await db.tenant.findFirstOrThrow({ where: { id: tenantId } })).portalPausedReason).toBeNull();
  });
});
