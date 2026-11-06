import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createLease, endLease, runRecurringForLease, activateLease } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import { assessLateFees, lateFeePolicy } from "@/server/leasing/late-fees";
import { runNightly } from "@/server/jobs/nightly";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { setSetting } from "@/server/settings/service";
import { parseISODate as d } from "@/lib/dates";
import { postEntry } from "@/server/ledger/journal";
import { UnbalancedEntryError } from "@/server/ledger/postings";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let db: ScopedDb;
let rentAcct: string;
let unitIds: string[];
let propertyId: string;
const actor = () => ({ orgId: A.orgId, userId: A.userId });

/** The four ledger invariants, checked after every scenario. */
async function assertInvariants(leaseId: string) {
  const entries = await db.journalEntry.findMany({ include: { lines: true } });
  for (const e of entries) {
    const dr = e.lines.reduce((s, l) => s + l.debitCents, 0);
    const cr = e.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(dr, `entry ${e.memo} balances`).toBe(cr);
  }
  const tb = await db.journalLine.aggregate({ _sum: { debitCents: true, creditCents: true } });
  expect(tb._sum.debitCents, "trial balance").toBe(tb._sum.creditCents);
  await db.tx(async (tx) => {
    const bal = await M.leaseBalance(tx, leaseId);
    const open = await M.openCharges(tx, leaseId);
    const unapplied = await M.unappliedSources(tx, leaseId);
    expect(bal.receivableCents, "A/R == open charges").toBe(open.reduce((s, c) => s + c.remainingCents, 0));
    expect(bal.prepaidCents, "Prepaid == unapplied payments").toBe(unapplied.reduce((s, u) => s + u.unappliedCents, 0));
  });
}
const balance = (leaseId: string) => db.tx((tx) => M.leaseBalance(tx, leaseId));

beforeAll(async () => {
  A = await makeOrg("LA");
  B = await makeOrg("LB");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  rentAcct = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const p = await createPropertyFromWizard(db, {
    type: "MULTI_FAMILY", name: "Ledger Flats",
    address: { addressLine1: "1 Ledger Way", city: "Chicago", state: "IL", postalCode: "60601" },
    units: [{ name: "1", marketRentCents: 150_000 }, { name: "2", marketRentCents: 150_000 }, { name: "3", marketRentCents: 150_000 }],
    owners: [],
  });
  propertyId = p.id;
  unitIds = (await db.unit.findMany({ where: { propertyId }, orderBy: { name: "asc" } })).map((u) => u.id);
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

const lease = (unit: number, over: Record<string, unknown> = {}) => ({
  propertyId, unitIds: [unitIds[unit]!], termType: "FIXED" as const, startDate: "2026-08-16", endDate: "2027-08-15", rentDueDay: 1,
  tenants: [{ newTenant: { firstName: "Tess", lastName: `Tenant${unit}` }, role: "PRIMARY" as const }],
  recurring: [{ kind: "RENT" as const, accountId: rentAcct, description: "Rent", amountCents: 155_000 }],
  deposit: { amountCents: 155_000, handling: "CHARGE" as const },
  ...over,
});

describe("lease creation + recurring engine", () => {
  let leaseId: string;
  it("posts deposit and prorated + catch-up rent through today", async () => {
    leaseId = (await createLease(db, lease(0), d("2026-11-06"))).id;
    const charges = await db.leaseTransaction.findMany({ where: { leaseId, type: "CHARGE" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
    expect(charges.map((c) => [c.chargeKind, c.amountCents, c.date.toISOString().slice(0, 10)])).toEqual([
      ["DEPOSIT", 155_000, "2026-08-16"],
      ["RENT", 80_000, "2026-08-16"], // 16 of 31 days, half-up
      ["RENT", 155_000, "2026-09-01"],
      ["RENT", 155_000, "2026-10-01"],
      ["RENT", 155_000, "2026-11-01"],
    ]);
    expect(charges[1]!.memo).toMatch(/prorated 16\/31 days/);
    expect((await balance(leaseId)).balanceCents).toBe(700_000);
    await assertInvariants(leaseId);
  });

  it("is idempotent: re-running for the same day posts nothing", async () => {
    const n = await db.tx((tx) => runRecurringForLease(tx, actor(), leaseId, d("2026-11-06")));
    expect(n).toBe(0);
    const again = await runNightly(db, { today: d("2026-11-06") });
    expect(again.charges).toBe(0);
    // The nightly job also catches up late fees for the unpaid Aug, Sep and Oct rent (Nov is still in grace).
    expect(again.lateFees).toBe(3);
    expect((await runNightly(db, { today: d("2026-11-06") })).lateFees).toBe(0);
    expect(await db.leaseTransaction.count({ where: { leaseId, type: "CHARGE", chargeKind: "RENT" } })).toBe(4);
  });

  it("payments apply oldest first; overpayment goes to prepaid and auto-applies to the next charge", async () => {
    await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 300_000, date: d("2026-11-06"), method: "CHECK", reference: "1001" }));
    let open = await db.tx((tx) => M.openCharges(tx, leaseId));
    // Deposit and Aug paid, 65,000 of Sep; then Oct, Nov and the three late fees.
    expect(open.map((c) => c.remainingCents)).toEqual([90_000, 155_000, 155_000, 5000, 5000, 5000]);
    await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 500_000, date: d("2026-11-07"), method: "ACH" }));
    expect(await balance(leaseId)).toMatchObject({ receivableCents: 0, prepaidCents: 85_000, balanceCents: -85_000 });
    const n = await db.tx((tx) => runRecurringForLease(tx, actor(), leaseId, d("2026-12-01")));
    expect(n).toBe(1);
    expect(await balance(leaseId)).toMatchObject({ receivableCents: 70_000, prepaidCents: 0, balanceCents: 70_000 });
    open = await db.tx((tx) => M.openCharges(tx, leaseId));
    expect(open.map((c) => c.remainingCents)).toEqual([70_000]);
    await assertInvariants(leaseId);
  });
});

describe("late fees (settings resolver: lease ?? property ?? org)", () => {
  let leaseId: string;
  beforeAll(async () => {
    leaseId = (await createLease(db, lease(1, { startDate: "2026-11-01", deposit: { amountCents: 0, handling: "NONE" } }), d("2026-11-01"))).id;
  });
  it("assesses once after the grace period and never twice", async () => {
    const { policy } = await lateFeePolicy(db, propertyId, leaseId);
    expect(await db.tx((tx) => assessLateFees(tx, actor(), leaseId, policy, d("2026-11-06")))).toBe(0); // within 5-day grace
    expect(await db.tx((tx) => assessLateFees(tx, actor(), leaseId, policy, d("2026-11-07")))).toBe(1);
    expect(await db.tx((tx) => assessLateFees(tx, actor(), leaseId, policy, d("2026-11-08")))).toBe(0);
    const fees = await db.leaseTransaction.findMany({ where: { leaseId, chargeKind: "LATE_FEE" } });
    expect(fees.map((f) => f.amountCents)).toEqual([5000]);
    await assertInvariants(leaseId);
  });
  it("lease-level override enables daily accrual, capped at the monthly max", async () => {
    await setSetting(db, "lateFees.dailyAccrual", "LEASE", leaseId, true);
    await setSetting(db, "lateFees.maxCents", "PROPERTY", propertyId, 8000);
    const { policy } = await lateFeePolicy(db, propertyId, leaseId);
    expect(policy).toMatchObject({ dailyAccrual: true, maxCents: 8000 });
    for (const day of ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
      await db.tx((tx) => assessLateFees(tx, actor(), leaseId, policy, d(day)));
    }
    const fees = await db.leaseTransaction.findMany({ where: { leaseId, chargeKind: "LATE_FEE" }, orderBy: { date: "asc" } });
    expect(fees.map((f) => f.amountCents)).toEqual([5000, 1000, 1000, 1000]);
    expect(fees.reduce((s, f) => s + f.amountCents, 0)).toBe(8000);
  });
  it("no fee when the rent is paid", async () => {
    await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 163_000, date: d("2026-11-12") }));
    expect((await balance(leaseId)).balanceCents).toBe(0);
    const { policy } = await lateFeePolicy(db, propertyId, leaseId);
    expect(await db.tx((tx) => assessLateFees(tx, actor(), leaseId, policy, d("2026-11-20")))).toBe(0);
    await assertInvariants(leaseId);
  });
});

describe("returned payments, voids, deposits, refunds", () => {
  let leaseId: string;
  beforeAll(async () => {
    leaseId = (await createLease(db, lease(2, { startDate: "2026-10-01", endDate: "2027-09-30", deposit: { amountCents: 100_000, handling: "RECEIVED" } }), d("2026-11-06"))).id;
  });
  it("deposit received sits in Deposits Held, not the tenant balance", async () => {
    expect((await balance(leaseId)).balanceCents).toBe(310_000);
    expect(await db.tx((tx) => M.depositHeld(tx, leaseId))).toBe(100_000);
  });
  it("returned payment reopens charges and adds an NSF fee", async () => {
    const pay = await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 310_000, date: d("2026-11-03"), method: "CHECK", reference: "555" }));
    expect((await balance(leaseId)).balanceCents).toBe(0);
    await db.tx((tx) => M.returnPayment(tx, actor(), { paymentId: pay.transaction.id, date: d("2026-11-05"), nsfFeeCents: 3500, reason: "NSF" }));
    expect((await balance(leaseId)).balanceCents).toBe(313_500);
    await expect(db.tx((tx) => M.returnPayment(tx, actor(), { paymentId: pay.transaction.id, date: d("2026-11-05") }))).rejects.toThrow(/already returned/);
    await assertInvariants(leaseId);
  });
  it("voiding a paid charge moves the payment to the credit balance", async () => {
    await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 313_500, date: d("2026-11-06") }));
    const oct = await db.leaseTransaction.findFirstOrThrow({ where: { leaseId, chargeKind: "RENT", date: d("2026-10-01") } });
    await db.tx((tx) => M.voidTransaction(tx, actor(), { id: oct.id, date: d("2026-11-06"), reason: "Billed in error" }));
    expect(await balance(leaseId)).toMatchObject({ balanceCents: -155_000, prepaidCents: 155_000 });
    const rev = await db.journalEntry.findFirst({ where: { reversesId: oct.journalEntryId } });
    expect(rev).not.toBeNull();
    await assertInvariants(leaseId);
  });
  it("voiding a payment reopens what it paid", async () => {
    const p = await db.tx((tx) => M.receivePayment(tx, actor(), { leaseId, amountCents: 10_000, date: d("2026-11-06") }));
    await db.tx((tx) => M.voidTransaction(tx, actor(), { id: p.transaction.id, date: d("2026-11-06"), reason: "Duplicate entry" }));
    expect((await balance(leaseId)).balanceCents).toBe(-155_000);
    await expect(db.tx((tx) => M.voidTransaction(tx, actor(), { id: p.transaction.id, date: d("2026-11-06"), reason: "again" }))).rejects.toThrow(/Already voided/);
    await assertInvariants(leaseId);
  });
  it("refunds: credit balance and deposit, never more than held", async () => {
    await db.tx((tx) => M.refund(tx, actor(), { leaseId, kind: "PREPAID", amountCents: 155_000, date: d("2026-11-06") }));
    expect((await balance(leaseId)).balanceCents).toBe(0);
    await expect(db.tx((tx) => M.refund(tx, actor(), { leaseId, kind: "DEPOSIT", amountCents: 100_001, date: d("2026-11-06") }))).rejects.toThrow(/deposit is held/);
    await db.tx((tx) => M.refund(tx, actor(), { leaseId, kind: "DEPOSIT", amountCents: 100_000, date: d("2026-11-06") }));
    expect(await db.tx((tx) => M.depositHeld(tx, leaseId))).toBe(0);
    await assertInvariants(leaseId);
  });
  it("credits apply to open charges", async () => {
    await db.tx((tx) => M.postCharge(tx, actor(), { leaseId, accountId: rentAcct, amountCents: 20_000, date: d("2026-11-06"), memo: "Parking" }));
    await db.tx((tx) => M.postCredit(tx, actor(), { leaseId, accountId: rentAcct, amountCents: 5_000, date: d("2026-11-06"), memo: "Concession" }));
    expect((await balance(leaseId)).balanceCents).toBe(15_000);
    await assertInvariants(leaseId);
  });
});

describe("one active lease per unit; move-out", () => {
  it("blocks overlapping leases with a link to the conflicting lease", async () => {
    await expect(createLease(db, lease(0, { startDate: "2026-12-01", endDate: "2027-11-30" }), d("2026-11-06"))).rejects.toThrow(/already has an active lease/);
    const draft = await createLease(db, lease(0, { status: "DRAFT", startDate: "2026-12-01", endDate: "2027-11-30" }), d("2026-11-06"));
    expect(await db.leaseTransaction.count({ where: { leaseId: draft.id } })).toBe(0);
    await expect(activateLease(db, draft.id, d("2026-11-06"))).rejects.toThrow(/overlaps/);
  });

  it("move-out mid-month credits unused rent and frees the unit", async () => {
    const l = await db.lease.findFirstOrThrow({ where: { units: { some: { unitId: unitIds[0] } }, status: "ACTIVE" } });
    await db.tx((tx) => runRecurringForLease(tx, actor(), l.id, d("2027-01-01")));
    const before = (await balance(l.id)).balanceCents;
    await endLease(db, l.id, { moveOutDate: "2027-01-10", reason: "Relocating", prorate: true }, d("2027-01-11"));
    const credit = await db.leaseTransaction.findFirstOrThrow({ where: { leaseId: l.id, type: "CREDIT" } });
    expect(credit.amountCents).toBe(155_000 - 50_000); // keep 10/31 days = 50,000
    expect((await balance(l.id)).balanceCents).toBe(before - 105_000);
    expect((await db.lease.findFirstOrThrow({ where: { id: l.id } })).status).toBe("ENDED");
    // Recurring stops: nothing posts for February.
    expect(await db.tx((tx) => runRecurringForLease(tx, actor(), l.id, d("2027-02-05")))).toBe(0);
    await assertInvariants(l.id);
    // The unit can be leased again after move-out.
    await expect(createLease(db, lease(0, { startDate: "2027-01-15", endDate: "2028-01-14", deposit: { amountCents: 0, handling: "NONE" } }), d("2027-01-11"))).resolves.toHaveProperty("id");
  });
});

describe("guards", () => {
  it("the journal writer rejects unbalanced entries", async () => {
    await expect(
      db.tx((tx) => postEntry(tx, A.orgId, A.userId, { date: d("2026-11-06"), source: "MANUAL", lines: [{ account: { id: rentAcct }, debitCents: 100, creditCents: 0 }, { account: { id: rentAcct }, debitCents: 0, creditCents: 99 }] })),
    ).rejects.toThrow(UnbalancedEntryError);
  });
  it("another org can't touch this org's lease", async () => {
    const dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
    const l = await db.lease.findFirstOrThrow();
    const rentB = (await dbB.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    await expect(dbB.tx((tx) => M.postCharge(tx, { orgId: B.orgId, userId: B.userId }, { leaseId: l.id, accountId: rentB, amountCents: 100, date: d("2026-11-06") }))).rejects.toThrow(/Lease not found/);
  });
});
