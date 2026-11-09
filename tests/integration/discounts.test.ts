import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createLease, runRecurringForLease } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { BUILT_IN_ROLES } from "@/server/permissions";
import * as D from "@/server/discounts/service";
import { parseISODate as d } from "@/lib/dates";
import { OTHER_REASON } from "@/lib/discounts";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let other: string;
let db: ScopedDb;
let rentAcct: string;
let propertyId: string;
let otherPropertyId: string;
let unitIds: string[];
const leases: string[] = [];

const owner = () => ({ orgId: A.orgId, userId: A.userId, name: "Owner", ip: "198.51.100.7", permissions: BUILT_IN_ROLES.ADMIN.permissions });
const manager = () => ({ orgId: A.orgId, userId: other, name: "Manager", ip: "198.51.100.8", permissions: BUILT_IN_ROLES.PROPERTY_MANAGER.permissions });
const maint = () => ({ orgId: A.orgId, userId: other, name: "Maint", ip: null, permissions: BUILT_IN_ROLES.MAINTENANCE.permissions });
const today = d("2026-11-06");
const REASON = "Move-in special / new lease promotion";

async function invariants(leaseId: string) {
  const tb = await db.journalLine.aggregate({ _sum: { debitCents: true, creditCents: true } });
  expect(tb._sum.debitCents).toBe(tb._sum.creditCents);
  await db.tx(async (tx) => {
    const bal = await M.leaseBalance(tx, leaseId);
    const open = await M.openCharges(tx, leaseId);
    const unapplied = await M.unappliedSources(tx, leaseId);
    expect(bal.receivableCents, "A/R == open charges").toBe(open.reduce((s, c) => s + c.remainingCents, 0));
    expect(bal.prepaidCents, "Prepaid == unapplied").toBe(unapplied.reduce((s, u) => s + u.unappliedCents, 0));
  });
}
const rentCharge = (leaseId: string, date: string) => db.leaseTransaction.findFirstOrThrow({ where: { leaseId, type: "CHARGE", chargeKind: "RENT", date: d(date) } });
const discountsOn = async (chargeId: string) => (await db.discountApplication.aggregate({ where: { chargeId }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
const base = (leaseId: string, over: Partial<D.DiscountInput> = {}): D.DiscountInput => ({ kind: "FIXED", value: 10_000, target: "CHARGE_KINDS", chargeKinds: ["RENT"], duration: "FOREVER", startDate: "2026-12-01", delivery: "DIRECT", leaseId, reason: REASON, ...over });

beforeAll(async () => {
  A = await makeOrg("DISC");
  other = (await admin.user.create({ data: { email: `disc-pm-${Date.now()}@test.local` } })).id;
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  rentAcct = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const p = await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Discount Flats", address: { addressLine1: "2 Promo St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [1, 2, 3, 4, 5].map((n) => ({ name: String(n), marketRentCents: 150_000 })), owners: [] });
  propertyId = p.id;
  otherPropertyId = (await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: "Other House", address: { addressLine1: "9 Elsewhere", city: "Chicago", state: "IL", postalCode: "60602" }, units: [{ name: "Main", marketRentCents: 100_000 }], owners: [] })).id;
  unitIds = (await db.unit.findMany({ where: { propertyId }, orderBy: { name: "asc" } })).map((u) => u.id);
  for (let i = 0; i < 5; i++) {
    leases.push((await createLease(db, {
      propertyId, unitIds: [unitIds[i]!], termType: "FIXED", startDate: "2026-08-16", endDate: "2027-08-15", rentDueDay: 1,
      tenants: [{ newTenant: { firstName: "Dee", lastName: `Count${i}` }, role: "PRIMARY" }],
      recurring: [{ kind: "RENT", accountId: rentAcct, description: "Rent", amountCents: 155_000 }],
      deposit: { amountCents: 155_000, handling: "CHARGE" },
    }, today)).id);
  }
});
afterAll(async () => {
  await cleanup([A.orgId], [A.userId, other]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("permissions and required reason", () => {
  it("staff without the Discounts permission can't give one; managers can give but not stop or approve", async () => {
    await expect(D.createDiscount(db, maint(), base(leases[0]!))).rejects.toThrow(/permission/);
    const r = await D.createDiscount(db, manager(), base(leases[0]!, { value: 100 }));
    await expect(D.revokeDiscount(db, manager(), r.discount.id, "Changed my mind")).rejects.toThrow(/Full access/);
    await D.revokeDiscount(db, owner(), r.discount.id, "Test cleanup");
  });
  it("a reason is required; Other needs words; made-up reasons are refused", async () => {
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { reason: "" }))).rejects.toThrow(/reason/);
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { reason: OTHER_REASON }))).rejects.toThrow(/Describe/);
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { reason: "Because I said so" }))).rejects.toThrow(/from the list/);
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { kind: "PERCENT", value: 0 }))).rejects.toThrow(/percent/);
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { value: 0 }))).rejects.toThrow(/more than/);
    const ok = await D.createDiscount(db, owner(), base(leases[0]!, { reason: OTHER_REASON, reasonOther: "Neighbour noise complaint", value: 100 }));
    expect(ok.discount.reasonText).toBe("Other: Neighbour noise complaint");
    await D.revokeDiscount(db, owner(), ok.discount.id, "Test cleanup");
  });
});

describe("direct concessions in the ledger", () => {
  it("10% off one charge: a credit tied to that charge, with before/after and audit", async () => {
    const nov = await rentCharge(leases[0]!, "2026-11-01");
    const before = await db.tx((tx) => M.leaseBalance(tx, leases[0]!));
    const r = await D.createDiscount(db, owner(), base(leases[0]!, { target: "SINGLE_CHARGE", chargeId: nov.id, kind: "PERCENT", value: 1000, duration: "ONCE" }));
    expect(r.appliedCents).toBe(15_500);
    const app1 = await db.discountApplication.findFirstOrThrow({ where: { discountId: r.discount.id } });
    expect(app1).toMatchObject({ chargeCents: 155_000, amountCents: 15_500, afterCents: 139_500 });
    const credit = await db.leaseTransaction.findFirstOrThrow({ where: { id: app1.creditId } });
    expect(credit).toMatchObject({ type: "CREDIT", chargeKind: "DISCOUNT", relatedId: nov.id, amountCents: 15_500 });
    expect(credit.memo).toContain(REASON);
    const conc = await db.account.findFirstOrThrow({ where: { systemKey: "CONCESSIONS" } });
    expect(credit.accountId).toBe(conc.id);
    expect((await db.tx((tx) => M.leaseBalance(tx, leases[0]!))).balanceCents).toBe(before.balanceCents - 15_500);
    const events = await db.discountEvent.findMany({ where: { discountId: r.discount.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["created", "applied"]);
    expect(events[0]).toMatchObject({ actorId: A.userId, ip: "198.51.100.7", reason: REASON });
    expect(await db.auditLog.count({ where: { entityType: "Discount", entityId: r.discount.id, action: "discount.created" } })).toBe(1);
    // Applying the same discount twice does nothing.
    await expect(D.createDiscount(db, owner(), base(leases[0]!, { target: "SINGLE_CHARGE", chargeId: (await db.leaseTransaction.findFirstOrThrow({ where: { leaseId: leases[0]!, chargeKind: "DEPOSIT" } })).id, duration: "ONCE" }))).rejects.toThrow(/deposits/);
    await invariants(leases[0]!);
  });

  it("$100 off rent for 2 months: only Dec and Jan rent, not late fees; stopping it is forward-only", async () => {
    const r = await D.createDiscount(db, owner(), base(leases[1]!, { duration: "MONTHS", months: 2, startDate: "2026-12-01" }));
    expect(r.appliedCents).toBe(0); // nothing posted in the window yet
    await db.tx((tx) => runRecurringForLease(tx, { orgId: A.orgId, userId: A.userId }, leases[1]!, d("2026-12-01")));
    const dec = await rentCharge(leases[1]!, "2026-12-01");
    expect(await discountsOn(dec.id)).toBe(10_000);
    // A late fee on the same lease isn't discounted (rent only).
    const lateAcct = (await db.account.findFirstOrThrow({ where: { systemKey: "LATE_FEE_INCOME" } })).id;
    const fee = await db.tx((tx) => M.postCharge(tx, { orgId: A.orgId, userId: A.userId }, { leaseId: leases[1]!, accountId: lateAcct, amountCents: 5000, date: d("2026-12-06"), chargeKind: "LATE_FEE" }));
    expect(await discountsOn(fee.id)).toBe(0);
    await db.tx((tx) => runRecurringForLease(tx, { orgId: A.orgId, userId: A.userId }, leases[1]!, d("2027-01-01")));
    expect(await discountsOn((await rentCharge(leases[1]!, "2027-01-01")).id)).toBe(10_000);
    await D.revokeDiscount(db, owner(), r.discount.id, "Tenant moved to a different special");
    await db.tx((tx) => runRecurringForLease(tx, { orgId: A.orgId, userId: A.userId }, leases[1]!, d("2027-02-01")));
    expect(await discountsOn((await rentCharge(leases[1]!, "2027-02-01")).id)).toBe(0);
    // History stays: both earlier discounts still there.
    expect(await db.discountApplication.count({ where: { discountId: r.discount.id } })).toBe(2);
    expect((await db.discountEvent.findMany({ where: { discountId: r.discount.id } })).map((e) => e.action)).toContain("revoked");
    await invariants(leases[1]!);
  });

  it("stacked discounts never take a charge below $0", async () => {
    const big = await D.createDiscount(db, owner(), base(leases[2]!, { value: 150_000, startDate: "2026-11-01", duration: "ONCE" }));
    expect(big.appliedCents).toBe(150_000);
    const half = await D.createDiscount(db, owner(), base(leases[2]!, { kind: "PERCENT", value: 5000, startDate: "2026-11-01", duration: "ONCE" }));
    expect(half.appliedCents).toBe(5000); // only $50 was left on November's rent
    const nov = await rentCharge(leases[2]!, "2026-11-01");
    expect(await discountsOn(nov.id)).toBe(155_000);
    await invariants(leases[2]!);
  });

  it("voiding a discounted charge removes its discount too", async () => {
    const nov = await rentCharge(leases[2]!, "2026-11-01");
    await db.tx((tx) => M.voidTransaction(tx, { orgId: A.orgId, userId: A.userId }, { id: nov.id, date: today, reason: "Posted in error" }));
    const credits = await db.leaseTransaction.findMany({ where: { relatedId: nov.id, chargeKind: "DISCOUNT" } });
    expect(credits).toHaveLength(2);
    expect(credits.every((c) => c.voidedAt)).toBe(true);
    await invariants(leases[2]!);
  });
});

describe("codes", () => {
  it("a tenant code: property scope, one use per lease, max uses, expiry", async () => {
    const r = await D.createDiscount(db, owner(), { kind: "FIXED", value: 2500, target: "CHARGE_KINDS", chargeKinds: ["RENT"], duration: "ONCE", startDate: "2026-11-01", delivery: "CODE", code: "fall-25", maxUses: 1, perTenantLimit: 1, propertyId, reason: "Referral reward" });
    expect(r.discount.code).toBe("FALL-25");
    await expect(D.createDiscount(db, owner(), { ...base(leases[3]!), delivery: "CODE", code: "FALL-25", leaseId: undefined })).rejects.toThrow(/already used/);
    const red = await D.redeemCode(db, owner(), { code: " fall-25 ", leaseId: leases[3]!, tenantId: null });
    expect(red.appliedCents).toBe(2500); // November rent, the first matching charge
    await expect(D.redeemCode(db, owner(), { code: "FALL-25", leaseId: leases[3]!, tenantId: null })).rejects.toThrow(/already used/);
    await expect(D.redeemCode(db, owner(), { code: "FALL-25", leaseId: leases[4]!, tenantId: null })).rejects.toThrow(/used up/);
    await expect(D.redeemCode(db, owner(), { code: "NOPE-NOPE", leaseId: leases[4]!, tenantId: null })).rejects.toThrow(/isn't valid/);
    // ONCE: the next month's rent isn't discounted again.
    await db.tx((tx) => runRecurringForLease(tx, { orgId: A.orgId, userId: A.userId }, leases[3]!, d("2026-12-01")));
    expect(await discountsOn((await rentCharge(leases[3]!, "2026-12-01")).id)).toBe(0);
    expect((await db.discountEvent.findMany({ where: { discountId: r.discount.id } })).map((e) => e.action)).toEqual(["created", "redeemed", "applied"]);
  });
  it("codes for another property, or past their date, are refused", async () => {
    await D.createDiscount(db, owner(), { kind: "PERCENT", value: 500, target: "CHARGE_KINDS", chargeKinds: [], duration: "FOREVER", startDate: "2026-11-01", delivery: "CODE", code: "OTHERHOUSE", propertyId: otherPropertyId, reason: "Owner discretion" });
    await expect(D.redeemCode(db, owner(), { code: "OTHERHOUSE", leaseId: leases[4]!, tenantId: null })).rejects.toThrow(/isn't for your home/);
    await D.createDiscount(db, owner(), { kind: "PERCENT", value: 500, target: "CHARGE_KINDS", chargeKinds: [], duration: "FOREVER", startDate: "2026-11-01", delivery: "CODE", code: "OLDCODE", codeExpiresAt: "2026-11-30", reason: "Owner discretion" });
    await expect(D.redeemCode(db, owner(), { code: "OLDCODE", leaseId: leases[4]!, tenantId: null }, new Date("2026-12-05T12:00:00Z"))).rejects.toThrow(/expired/);
  });
});

describe("approval above the owner's threshold", () => {
  it("a manager's big discount waits; they can't approve their own; the owner approves and it applies", async () => {
    await D.saveDiscountPolicy(db, owner(), { reasons: [REASON, "Referral reward", "Owner discretion"], overCents: 5000, overPercentBps: 0 });
    await expect(D.saveDiscountPolicy(db, manager(), { reasons: ["x"], overCents: 0, overPercentBps: 0 })).rejects.toThrow(/Full access/);
    const r = await D.createDiscount(db, manager(), base(leases[4]!, { startDate: "2026-11-01", duration: "ONCE" }));
    expect(r.pending).toBe(true);
    expect(r.appliedCents).toBe(0);
    await expect(D.approveDiscount(db, manager(), r.discount.id)).rejects.toThrow(/Full access/);
    await expect(D.approveDiscount(db, { ...owner(), userId: other }, r.discount.id)).rejects.toThrow(/Someone else/);
    expect(await D.approveDiscount(db, owner(), r.discount.id)).toBe(10_000);
    const n = await db.discount.findFirstOrThrow({ where: { id: r.discount.id } });
    expect(n).toMatchObject({ status: "ACTIVE", approvedById: A.userId });
    // Under the threshold: no approval needed. Owners (Full access) aren't held up by it.
    expect((await D.createDiscount(db, manager(), base(leases[4]!, { value: 4000 }))).pending).toBe(false);
    expect((await D.createDiscount(db, owner(), base(leases[4]!, { value: 90_000 }))).pending).toBe(false);
    const rej = await D.createDiscount(db, manager(), base(leases[4]!, { value: 9000 }));
    await D.rejectDiscount(db, owner(), rej.discount.id, "Too generous");
    expect((await db.discount.findFirstOrThrow({ where: { id: rej.discount.id } })).status).toBe("REJECTED");
    await invariants(leases[4]!);
  });
});

describe("history can't be changed", () => {
  it("the app's database login can add discount events but not edit or delete them", async () => {
    const e = await db.discountEvent.findFirstOrThrow();
    await expect(db.discountEvent.update({ where: { id: e.id }, data: { reason: "rewritten" } })).rejects.toThrow();
    await expect(db.discountEvent.deleteMany({ where: { id: e.id } })).rejects.toThrow();
    expect((await db.discountEvent.findFirstOrThrow({ where: { id: e.id } })).reason).toBe(e.reason);
  });
});
