import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import { saveVendor } from "@/server/maintenance/vendors";
import * as AP from "@/server/accounting/payables";
import * as BK from "@/server/accounting/banking";
import * as OW from "@/server/accounting/owners";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let db: ScopedDb;
let propertyId: string;
let property2: string;
let unitId: string;
let vendorId: string;
let leaseId: string;
let ownerA: string;
let ownerB: string;
const acct = async (key: string) => (await db.account.findFirstOrThrow({ where: { systemKey: key } })).id;
const balanceOf = async (accountId: string, propertyId?: string) => {
  const s = await db.journalLine.aggregate({ where: { accountId, ...(propertyId ? { propertyId } : {}) }, _sum: { debitCents: true, creditCents: true } });
  return (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0);
};
async function trialBalanceHolds() {
  const tb = await db.journalLine.aggregate({ _sum: { debitCents: true, creditCents: true } });
  expect(tb._sum.debitCents).toBe(tb._sum.creditCents);
}

beforeAll(async () => {
  A = await makeOrg("AA");
  B = await makeOrg("AB");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  ownerA = (await db.owner.create({ data: { organizationId: A.orgId, firstName: "Ada", lastName: "Owner" } })).id;
  ownerB = (await db.owner.create({ data: { organizationId: A.orgId, firstName: "Ben", lastName: "Owner" } })).id;
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Books Flats", address: { addressLine1: "1 Books St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 100_000 }, { name: "2", marketRentCents: 100_000 }], owners: [{ ownerId: ownerA, percentBps: 6000 }, { ownerId: ownerB, percentBps: 4000 }] })).id;
  property2 = (await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: "Books House", address: { addressLine1: "2 Books St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "Main", marketRentCents: 1 }], owners: [] })).id;
  unitId = (await db.unit.findFirstOrThrow({ where: { propertyId, name: "1" } })).id;
  vendorId = (await saveVendor(db, null, { name: "Fix-It Co", email: "fix@example.com", trades: ["GENERAL"] })).id;
  const rent = await acct("RENT_INCOME");
  leaseId = (await createLease(db, {
    propertyId, unitIds: [unitId], termType: "FIXED", startDate: "2026-10-01", endDate: "2027-09-30", rentDueDay: 1,
    tenants: [{ newTenant: { firstName: "Rita", lastName: "Renter" }, role: "PRIMARY" }],
    recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 100_000 }],
    deposit: { amountCents: 0, handling: "NONE" },
  }, d("2026-10-01"))).id;
  await db.tx((tx) => M.receivePayment(tx, { orgId: A.orgId, userId: A.userId }, { leaseId, amountCents: 100_000, date: d("2026-10-03"), method: "CHECK", reference: "101" }));
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("bills & payables", () => {
  it("bill credits A/P by property; partial then full payment updates status; overpay rejected", async () => {
    const repairs = await acct("REPAIRS");
    const ap = await acct("ACCOUNTS_PAYABLE");
    const cash = await acct("OPERATING_CASH");
    const bill = await AP.createBill(db, { vendorId, billNumber: "F-1", billDate: "2026-10-05", dueDate: "2026-10-20", lines: [{ accountId: repairs, amountCents: 30_000, propertyId }, { accountId: repairs, amountCents: 10_000, propertyId: property2 }] });
    expect(await balanceOf(ap, propertyId)).toBe(-30_000);
    expect(await balanceOf(ap, property2)).toBe(-10_000);
    await AP.payBill(db, { billId: bill.id, amountCents: 20_000, date: "2026-10-10", bankAccountId: cash });
    expect((await db.bill.findFirstOrThrow({ where: { id: bill.id } })).status).toBe("PARTIALLY_PAID");
    // the payment is split 3:1 across the properties, like the bill
    expect(await balanceOf(ap, propertyId)).toBe(-15_000);
    await expect(AP.payBill(db, { billId: bill.id, amountCents: 30_000, date: "2026-10-10", bankAccountId: cash })).rejects.toThrow(/still owed/);
    await AP.payBill(db, { billId: bill.id, date: "2026-10-11", bankAccountId: cash });
    expect((await db.bill.findFirstOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
    expect(await balanceOf(ap)).toBe(0);
    await expect(AP.payBill(db, { billId: bill.id, date: "2026-10-11", bankAccountId: cash })).rejects.toThrow(/already paid/);
    await trialBalanceHolds();
  });

  it("bulk-pays bills all-or-nothing", async () => {
    const repairs = await acct("REPAIRS");
    const cash = await acct("OPERATING_CASH");
    const b1 = await AP.createBill(db, { vendorId, billDate: "2026-10-06", dueDate: "2026-10-20", lines: [{ accountId: repairs, amountCents: 1_000, propertyId }] });
    const b2 = await AP.createBill(db, { vendorId, billDate: "2026-10-06", dueDate: "2026-10-20", lines: [{ accountId: repairs, amountCents: 2_000, propertyId }] });
    const r = await AP.payBills(db, { billIds: [b1.id, b2.id], date: "2026-10-12", bankAccountId: cash });
    expect(r).toEqual({ count: 2, totalCents: 3_000 });
    const b3 = await AP.createBill(db, { vendorId, billDate: "2026-10-06", dueDate: "2026-10-20", lines: [{ accountId: repairs, amountCents: 500, propertyId }] });
    await expect(AP.payBills(db, { billIds: [b3.id, b1.id], date: "2026-10-12", bankAccountId: cash })).rejects.toThrow(/already paid/);
    expect((await db.bill.findFirstOrThrow({ where: { id: b3.id } })).status).toBe("OPEN"); // rolled back
  });

  it("vendor credit reduces the bill and the expense; void bill requires no payments", async () => {
    const repairs = await acct("REPAIRS");
    const bill = await AP.createBill(db, { vendorId, billDate: "2026-10-07", dueDate: "2026-10-21", lines: [{ accountId: repairs, amountCents: 5_000, propertyId }] });
    const before = await balanceOf(repairs);
    await AP.createVendorCredit(db, { vendorId, date: "2026-10-08", amountCents: 1_500, accountId: repairs, propertyId, applyToBillId: bill.id });
    expect(await balanceOf(repairs)).toBe(before - 1_500);
    expect(await AP.billOpenCents(db, bill.id)).toBe(3_500);
    await expect(AP.voidBill(db, bill.id, "dup")).rejects.toThrow(/credits/);
    const other = await AP.createBill(db, { vendorId, billDate: "2026-10-07", dueDate: "2026-10-21", lines: [{ accountId: repairs, amountCents: 700 }] });
    await AP.voidBill(db, other.id, "entered twice");
    expect((await db.bill.findFirstOrThrow({ where: { id: other.id } })).status).toBe("VOID");
    await trialBalanceHolds();
  });

  it("expenses post Dr expense / Cr bank; reject income accounts", async () => {
    const util = await acct("UTILITIES");
    const cash = await acct("OPERATING_CASH");
    const before = await balanceOf(cash, propertyId);
    await AP.createExpense(db, { payee: "City Water", date: "2026-10-09", bankAccountId: cash, lines: [{ accountId: util, amountCents: 4_200, propertyId }] });
    expect(await balanceOf(cash, propertyId)).toBe(before - 4_200);
    await expect(AP.createExpense(db, { payee: "X", date: "2026-10-09", bankAccountId: cash, lines: [{ accountId: await acct("RENT_INCOME"), amountCents: 1 }] })).rejects.toThrow(/expense accounts/);
  });

  it("recurring bills are created once per period", async () => {
    const util = await acct("UTILITIES");
    await AP.saveRecurringBill(db, null, { vendorId, memo: "Trash service", lines: [{ accountId: util, amountCents: 8_000, propertyId }], dayOfMonth: 5, startDate: "2026-09-01" });
    expect(await AP.runRecurringBills(db, d("2026-10-20"))).toBe(2); // Sep 5 + Oct 5
    expect(await AP.runRecurringBills(db, d("2026-10-25"))).toBe(0);
    expect(await db.bill.count({ where: { billNumber: { startsWith: "AUTO-" } } })).toBe(2);
  });
});

describe("banking", () => {
  it("deposits undeposited payments to the bank, by property", async () => {
    const und = await acct("UNDEPOSITED_FUNDS");
    const cash = await acct("OPERATING_CASH");
    const open = await BK.undepositedPayments(db);
    expect(open).toHaveLength(1);
    const before = await balanceOf(cash, propertyId);
    await BK.createDeposit(db, { bankAccountId: cash, date: "2026-10-04", paymentIds: open.map((p) => p.id) });
    expect(await balanceOf(und)).toBe(0);
    expect(await balanceOf(cash, propertyId)).toBe(before + 100_000);
    expect(await BK.undepositedPayments(db)).toHaveLength(0);
    await expect(BK.createDeposit(db, { bankAccountId: cash, date: "2026-10-04", paymentIds: [open[0]!.id] })).rejects.toThrow(/already deposited/);
  });

  it("a returned payment after deposit comes out of the bank, not Undeposited Funds", async () => {
    const und = await acct("UNDEPOSITED_FUNDS");
    const cash = await acct("OPERATING_CASH");
    const { transaction: p } = await db.tx((tx) => M.receivePayment(tx, { orgId: A.orgId, userId: A.userId }, { leaseId, amountCents: 5_000, date: d("2026-10-15") }));
    await BK.createDeposit(db, { bankAccountId: cash, date: "2026-10-15", paymentIds: [p.id] });
    const cashBefore = await balanceOf(cash);
    await db.tx((tx) => M.returnPayment(tx, { orgId: A.orgId, userId: A.userId }, { paymentId: p.id, date: d("2026-10-18") }));
    expect(await balanceOf(und)).toBe(0);
    expect(await balanceOf(cash)).toBe(cashBefore - 5_000);
  });

  it("transfers between bank accounts", async () => {
    const cash = await acct("OPERATING_CASH");
    const dep = await acct("DEPOSIT_CASH");
    await BK.createTransfer(db, { fromAccountId: cash, toAccountId: dep, amountCents: 1_000, date: "2026-10-16" });
    expect(await balanceOf(dep)).toBe(1_000);
    await expect(BK.createTransfer(db, { fromAccountId: cash, toAccountId: cash, amountCents: 1, date: "2026-10-16" })).rejects.toThrow(/different/);
  });

  it("mock feed sync auto-matches ledger lines; fees can be categorized; reconciliation must balance", async () => {
    const cash = await acct("OPERATING_CASH");
    const r = await BK.syncBankFeed(db, cash, d("2026-10-31"));
    expect(r.added).toBeGreaterThan(3);
    expect((await BK.syncBankFeed(db, cash, d("2026-10-31"))).added).toBe(0); // idempotent
    const matched = await db.bankTransaction.count({ where: { bankAccountId: cash, status: "MATCHED" } });
    expect(matched).toBeGreaterThan(0);
    const fee = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: cash, description: "MONTHLY SERVICE FEE", status: "UNMATCHED" } });
    const bankFees = (await db.account.findFirstOrThrow({ where: { name: "Bank Fees" } })).id;
    await BK.categorizeBankTransaction(db, fee.id, { accountId: bankFees });
    expect((await db.bankTransaction.findFirstOrThrow({ where: { id: fee.id } })).status).toBe("CATEGORIZED");

    const ledger = await balanceOf(cash);
    const rec = await BK.startReconciliation(db, { bankAccountId: cash, statementDate: "2026-10-31", statementBalanceCents: ledger });
    const ws = await BK.reconciliationWorkspace(db, rec.id);
    const all = ws.lines.map((l) => l.id);
    await expect(BK.completeReconciliation(db, rec.id, all.slice(1))).rejects.toThrow(/difference must be \$0.00/);
    await BK.completeReconciliation(db, rec.id, all);
    expect(await db.journalLine.count({ where: { reconciliationId: rec.id } })).toBe(all.length);
    const next = await BK.startReconciliation(db, { bankAccountId: cash, statementDate: "2026-11-30", statementBalanceCents: ledger });
    expect(next.openingBalanceCents).toBe(ledger);
    await expect(BK.undoReconciliation(db, rec.id)).resolves.toBeUndefined();
  });

  it("CSV import parses debit/credit columns and dedupes", async () => {
    const { parseBankCsv } = await import("@/adapters/bank-feed");
    const { ok, errors } = parseBankCsv([{ Date: "10/20/2026", Description: "HOME DEPOT", Debit: "45.10", Credit: "" }, { Date: "2026-10-21", Description: "Refund", Amount: "12.00" }, { Date: "nope", Amount: "1" }]);
    expect(ok.map((t) => t.amountCents)).toEqual([-4_510, 1_200]);
    expect(errors).toHaveLength(1);
    const cash = await acct("OPERATING_CASH");
    expect((await BK.importBankCsv(db, cash, ok)).added).toBe(2);
    expect((await BK.importBankCsv(db, cash, ok)).added).toBe(0);
  });
});

describe("owners & management fees", () => {
  it("management fee: % of collected rent, billed and paid once per period", async () => {
    await OW.saveFeeRules(db, [{ propertyId: null, type: "PERCENT", percentBps: 800, flatCents: 0, minimumCents: 5_000, basis: "COLLECTED_RENT" }, { propertyId: property2, type: "FLAT", percentBps: 0, flatCents: 2_500, minimumCents: 0, basis: "COLLECTED_RENT" }]);
    expect(await OW.feeBasis(db, propertyId, "2026-10", "COLLECTED_RENT")).toBe(100_000);
    const r = await OW.runManagementFees(db, "2026-10");
    expect(r.created).toBe(2);
    expect(r.totalCents).toBe(8_000 + 2_500);
    const run = await db.managementFeeRun.findFirstOrThrow({ where: { propertyId, period: "2026-10" } });
    expect(run.feeCents).toBe(8_000);
    expect((await db.bill.findFirstOrThrow({ where: { id: run.billId! } })).status).toBe("PAID");
    expect((await OW.runManagementFees(db, "2026-10")).created).toBe(0);
    expect(await balanceOf(await acct("MANAGEMENT_FEES"), propertyId)).toBe(8_000);
  });

  it("available cash excludes payables and reserve; distribution splits by ownership", async () => {
    const repairs = await acct("REPAIRS");
    await db.property.update({ where: { id: propertyId }, data: { reserveCents: 10_000 } });
    await AP.createBill(db, { vendorId, billDate: "2026-10-20", dueDate: "2026-11-20", lines: [{ accountId: repairs, amountCents: 3_333, propertyId }] });
    const [c] = await OW.availableCash(db, [propertyId]);
    expect(c!.availableCents).toBe(Math.max(0, c!.bankCents + c!.undepositedCents - c!.prepaidCents - c!.payablesCents - 10_000));
    expect(c!.owners.map((o) => o.shareCents).reduce((a, b) => a + b, 0)).toBe(c!.availableCents);
    expect(c!.owners[0]!.percentBps).toBe(6000);
    await expect(OW.distribute(db, { propertyId, date: "2026-10-31", amounts: [{ ownerId: ownerA, amountCents: c!.availableCents + 1 }] })).rejects.toThrow(/available/);
    const r = await OW.distributeAll(db, { propertyIds: [propertyId], date: "2026-10-31" });
    expect(r.totalCents).toBe(c!.availableCents);
    expect((await OW.availableCash(db, [propertyId]))[0]!.availableCents).toBe(0);
    expect(await balanceOf(await acct("OWNER_DISTRIBUTIONS"), propertyId)).toBe(c!.availableCents);
    await OW.recordContribution(db, { propertyId, ownerId: ownerB, amountCents: 50_000, date: "2026-11-01" });
    expect((await OW.availableCash(db, [propertyId]))[0]!.availableCents).toBe(50_000);
    await trialBalanceHolds();
  });

  it("another org can't pay this org's bill or deposit its payments", async () => {
    const dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
    const bill = await db.bill.findFirstOrThrow({ where: { status: "OPEN" } });
    const bCash = (await dbB.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
    await expect(AP.payBill(dbB, { billId: bill.id, date: "2026-10-31", bankAccountId: bCash })).rejects.toThrow(/not found/);
    expect(await BK.undepositedPayments(dbB)).toHaveLength(0);
  });
});
