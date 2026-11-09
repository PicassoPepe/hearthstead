import { createNodePrisma } from "./node-client.mjs";
import bcrypt from "bcryptjs";
import { createScopedClient } from "../src/server/dal";
import * as P from "../src/server/payments/service";
import * as M from "../src/server/leasing/money";
import { addDays } from "../src/lib/dates";

/**
 * Phase 4 demo data: mock processor connected, a tenant portal login with a balance due,
 * saved methods, autopay for a handful of tenants, and recent online payments in every status.
 */
export async function seedPayments(adminUrl: string, appUrl: string, orgId: string, staffUserId: string, today: Date, password: string) {
  const admin = createNodePrisma(adminUrl);
  const app = createNodePrisma(appUrl);
  const db = createScopedClient(app, { orgId, userId: staffUserId });
  await P.connectProcessor(db, "Maple & Main Property Co.", "office@maplemain.example");
  // Payments are on: pass card fees through, ACH free; partial payments allowed company-wide.
  await db.setting.create({ data: { organizationId: orgId, scope: "ORG", scopeId: orgId, key: "tenantPortal.allowPartialPayments", value: true } });

  // Demo tenant login: the primary tenant on a residential lease that owes money.
  const leases = await db.lease.findMany({ where: { status: "ACTIVE", property: { type: { notIn: ["COMMERCIAL_OFFICE", "COMMERCIAL_RETAIL", "COMMERCIAL_INDUSTRIAL"] } } }, include: { tenants: { where: { role: "PRIMARY" }, include: { tenant: true } } }, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  let demoLeaseId: string | null = null;
  for (const l of leases) {
    const b = await db.tx((tx) => M.leaseBalance(tx, l.id));
    if (b.balanceCents > 0 && b.balanceCents < 400_000 && l.tenants[0]?.tenant.kind === "PERSON") { demoLeaseId = l.id; break; }
  }
  const demo = leases.find((l) => l.id === demoLeaseId)!;
  const demoTenant = demo.tenants[0]!.tenant;
  await db.tenant.update({ where: { id: demoTenant.id }, data: { email: "tenant@example.com" } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await admin.user.upsert({ where: { email: "tenant@example.com" }, create: { email: "tenant@example.com", name: `${demoTenant.firstName} ${demoTenant.lastName}`, passwordHash, emailVerified: new Date() }, update: { passwordHash } });
  await db.tenantUser.create({ data: { organizationId: orgId, tenantId: demoTenant.id, userId: user.id, acceptedAt: new Date() } });
  await db.tenant.update({ where: { id: demoTenant.id }, data: { portalStatus: "ACTIVE" } });
  await P.savePaymentMethod(db, demoTenant.id, { type: "ACH", bank: { routingNumber: "110000000", accountNumber: "000123456789", holderName: `${demoTenant.firstName} ${demoTenant.lastName}` } });

  // Saved methods, autopay and recent online payments for the other residential tenants.
  let payments = 0;
  let autopays = 0;
  for (const [i, l] of leases.filter((x) => x.id !== demoLeaseId).slice(0, 14).entries()) {
    const t = l.tenants[0]?.tenant;
    if (!t || !t.email) continue;
    const method = i % 3 === 0
      ? await P.savePaymentMethod(db, t.id, { type: "CARD", card: { number: "4242424242424242", expMonth: 9, expYear: 2029, cvc: "123" } })
      : await P.savePaymentMethod(db, t.id, { type: "ACH", bank: { routingNumber: "110000000", accountNumber: i === 5 ? "000000000002" : `0001234${String(5000 + i)}`, holderName: t.firstName ?? "Tenant" } });
    await db.tenant.update({ where: { id: t.id }, data: { portalStatus: "ACTIVE" } });
    if (i % 2 === 0) {
      await db.autopay.create({ data: { organizationId: orgId, leaseId: l.id, tenantId: t.id, paymentMethodId: method.id, dayOfMonth: 1 } });
      autopays++;
    }
    // Make this month's payment online if something is owed (spread over the last few days).
    const bal = await db.tx((tx) => M.leaseBalance(tx, l.id));
    if (bal.balanceCents <= 0) {
      // Already paid offline this month: add a small parking/other charge so there's something to pay.
      continue;
    }
    const day = addDays(today, -(i % 5));
    const pi = await P.startPayment(db, { leaseId: l.id, tenantId: t.id, paymentMethodId: method.id, amountCents: bal.balanceCents, origin: i % 2 === 0 ? "AUTOPAY" : "PORTAL", idempotencyKey: `seed:${l.id}`, today: day });
    payments++;
    // Older ones have settled and paid out; the newest stay processing.
    await P.advanceMockPayments(db, addDays(day, 2));
    if (i % 5 >= 4) await P.advanceMockPayments(db, addDays(day, 4));
    void pi;
  }
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
  return { demoTenant: `${demoTenant.firstName} ${demoTenant.lastName}`, payments, autopays };
}
