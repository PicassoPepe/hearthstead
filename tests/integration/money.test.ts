import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import { postEntry } from "@/server/ledger/journal";
import { closeYear, reopenYear, previewClose } from "@/server/accounting/close";
import { activeMonths, budgetFill, budgetVsActual, createBudget, saveBudgetAmounts, spread } from "@/server/accounting/budgets";
import { postBillback, previewBillback } from "@/server/accounting/billback";
import { forms1099, irisCsv } from "@/server/accounting/tax1099";
import { incomeExpense } from "@/server/reports/engine";
import { BUILT_IN_ROLES } from "@/server/permissions";
import type { AppContext } from "@/server/context";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let db: ScopedDb;
let ctx: AppContext;
let propertyId: string;
let utilities: string;
let leaseA: string;

beforeAll(async () => {
  O = await makeOrg("MONEY");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  ctx = { db, org: { id: O.orgId, name: "Test MONEY" }, user: { id: O.userId, email: "m@test.local", name: "Mo", preferences: {} }, membership: { propertyScope: [], roleKey: "ADMIN" }, permissions: BUILT_IN_ROLES.ADMIN.permissions } as unknown as AppContext;
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Money Flats", address: { addressLine1: "9 Cash St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 100_000, sqft: 600 }, { name: "2", marketRentCents: 150_000, sqft: 1_200 }], owners: [] })).id;
  const units = await db.unit.findMany({ where: { propertyId }, orderBy: { name: "asc" } });
  const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  utilities = (await db.account.findFirstOrThrow({ where: { systemKey: "UTILITIES" } })).id;
  leaseA = (await createLease(db, { propertyId, unitIds: [units[0]!.id], termType: "FIXED", startDate: "2025-01-01", endDate: "2027-12-31", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Ana", lastName: "One", email: `ana-${O.orgId}@t.local` }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 100_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2025-12-31"))).id;
  await createLease(db, { propertyId, unitIds: [units[1]!.id], termType: "FIXED", startDate: "2026-01-01", endDate: "2027-12-31", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Bo", lastName: "Two", email: `bo-${O.orgId}@t.local` }, role: "PRIMARY" }, { newTenant: { firstName: "Cy", lastName: "Two", email: `cy-${O.orgId}@t.local` }, role: "COTENANT" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 150_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-10-31"));
  // A water bill in October 2026.
  await db.tx((tx) => postEntry(tx, O.orgId, O.userId, { date: d("2026-10-20"), memo: "City water", source: "MANUAL", lines: [{ account: { id: utilities }, debitCents: 90_000, creditCents: 0, propertyId }, { account: { key: "OPERATING_CASH" }, debitCents: 0, creditCents: 90_000, propertyId }] }));
});
afterAll(async () => {
  await cleanup([O.orgId], [O.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("year-end close", () => {
  it("moves 2025 net income to retained earnings, locks the books, keeps the P&L intact; reopen undoes it", async () => {
    const pv = await previewClose(db, 2025);
    expect(pv.netIncomeCents).toBe(1_200_000); // 12 months of $1,000 rent
    await expect(closeYear(db, 2026, d("2026-11-08"))).rejects.toThrow(/isn't over/);
    await closeYear(db, 2025, d("2026-11-08"));
    await expect(closeYear(db, 2025, d("2026-11-08"))).rejects.toThrow(/already closed/);
    // P&L for 2025 still shows the income (closing entries are excluded).
    const ie = await incomeExpense(ctx, { from: "2025-01-01", to: "2025-12-31", basis: "ACCRUAL", propertyIds: null, col: () => "t" });
    const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    expect(ie.get(rent)?.get("t")).toBe(1_200_000);
    // Retained earnings holds it.
    const re = await db.account.findFirstOrThrow({ where: { systemKey: "RETAINED_EARNINGS" } });
    const reSum = await db.journalLine.aggregate({ where: { accountId: re.id }, _sum: { creditCents: true, debitCents: true } });
    expect((reSum._sum.creditCents ?? 0) - (reSum._sum.debitCents ?? 0)).toBe(1_200_000);
    // Locked: nothing can be posted into 2025.
    await expect(db.tx((tx) => postEntry(tx, O.orgId, O.userId, { date: d("2025-06-01"), source: "MANUAL", lines: [{ account: { id: utilities }, debitCents: 100, creditCents: 0 }, { account: { key: "OPERATING_CASH" }, debitCents: 0, creditCents: 100 }] }))).rejects.toThrow(/closed through 2025-12-31/);
    await reopenYear(db, 2025);
    const after = await db.journalLine.aggregate({ where: { accountId: re.id }, _sum: { creditCents: true, debitCents: true } });
    expect((after._sum.creditCents ?? 0) - (after._sum.debitCents ?? 0)).toBe(0);
    expect((await admin.organization.findUniqueOrThrow({ where: { id: O.orgId } })).booksClosedThrough).toBeNull();
  });
});

describe("budgets", () => {
  it("starts from last year's actuals (+10%), edits, and compares to actuals", async () => {
    expect(spread(100_000)).toEqual([8_334, 8_334, 8_334, 8_334, 8_333, 8_333, 8_333, 8_333, 8_333, 8_333, 8_333, 8_333]);
    const b = await createBudget(ctx, { name: "2026 plan", year: 2026, propertyId, start: "LAST_YEAR", adjustPct: 10 });
    const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    expect((b.amounts as Record<string, number[]>)[rent]![0]).toBe(110_000);
    await saveBudgetAmounts(db, b.id, { ...(b.amounts as object), [utilities]: spread(600_000) });
    const r = (await budgetVsActual(ctx, b.id, 9))!; // through October
    const rentRow = r.rows.find((x) => x.accountId === rent)!;
    expect(rentRow.budgetYtd).toBe(1_100_000);
    expect(rentRow.actualYtd).toBe(1_500_000); // unit 2 for Jan–Oct (unit 1 was only billed through 2025 here)
    expect(rentRow.varianceYtd).toBe(400_000); // favorable
    const util = r.rows.find((x) => x.accountId === utilities)!;
    expect(util.actualYtd).toBe(90_000);
    expect(util.varianceYtd).toBe(util.budgetYtd - 90_000);
    await expect(saveBudgetAmounts(db, b.id, { nope: [1] })).rejects.toThrow(/Unknown account/);
  });
});

describe("budget fill-in", () => {
  it("fills from leases (with or without renewals), repeating bills and another budget", async () => {
    expect(activeMonths(2027, d("2027-03-15"), d("2027-05-01"))).toEqual([false, false, true, true, true, false, false, false, false, false, false, false]);
    const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    const vendor = await db.vendor.create({ data: { organizationId: O.orgId, name: "Green Lawns" } });
    await db.recurringBill.create({ data: { organizationId: O.orgId, vendorId: vendor.id, dayOfMonth: 5, nextRunDate: d("2027-03-05"), lines: [{ accountId: utilities, amountCents: 5_000, propertyId }, { accountId: utilities, amountCents: 7_777, propertyId: "other-property" }] } });
    const b27 = await createBudget(ctx, { name: "2027", year: 2027, propertyId, start: "BLANK" });
    const f = await budgetFill(ctx, b27.id, { leases: true, assumeRenew: false, bills: true });
    expect(f.amounts[rent]).toEqual(Array(12).fill(250_000));
    expect(f.amounts[utilities]).toEqual([0, 0, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
    expect(f.sources.map((s) => s.key)).toEqual(["leases", "bills"]);
    const b28 = await createBudget(ctx, { name: "2028", year: 2028, propertyId, start: "BLANK" });
    expect((await budgetFill(ctx, b28.id, { leases: true, assumeRenew: false })).amounts[rent]).toBeUndefined(); // both leases end in 2027
    expect((await budgetFill(ctx, b28.id, { leases: true, assumeRenew: true })).amounts[rent]).toEqual(Array(12).fill(250_000));
    await saveBudgetAmounts(db, b27.id, f.amounts);
    expect((await budgetFill(ctx, b28.id, { copyBudgetId: b27.id })).amounts[utilities]![2]).toBe(5_000);
    await expect(budgetFill(ctx, b28.id, {})).rejects.toThrow(/Pick at least one/);
  });
});

describe("utility billback (RUBS)", () => {
  it("splits October's water bill 50/50 by sqft and occupants at 90% recovery, once", async () => {
    const v = { propertyId, period: "2026-10", expenseAccountId: utilities, method: "SQFT_OCCUPANTS" as const, recoveryPct: 90, label: "Water" };
    const p = await previewBillback(db, v);
    expect(p).toMatchObject({ billCents: 90_000, recoverCents: 81_000, ownerShareCents: 9_000 });
    // Unit 1: 600/1800 sqft, 1 of 3 occupants → 1/3; unit 2: 2/3.
    expect(p.lines.map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([27_000, 54_000]);
    await postBillback(db, v);
    const charge = await db.leaseTransaction.findFirst({ where: { leaseId: leaseA, memo: { startsWith: "Water billback" } } });
    expect(charge?.amountCents).toBe(27_000);
    await expect(postBillback(db, v)).rejects.toThrow(/already billed/);
  });
});

describe("1099 export", () => {
  it("lists vendors over $600 with readiness, as an IRIS-style CSV", async () => {
    const v = await db.vendor.create({ data: { organizationId: O.orgId, name: "Pipe Pros", send1099: true, w9OnFile: true, taxIdLast4: "6789", addressLine1: "1 Pipe Rd", city: "Chicago", state: "IL", postalCode: "60602" } });
    await db.vendor.create({ data: { organizationId: O.orgId, name: "No W9 LLC", send1099: true } });
    const w = await db.vendor.findFirstOrThrow({ where: { name: "No W9 LLC" } });
    const rep = (await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } })).id;
    const { createExpense } = await import("@/server/accounting/payables");
    const cash = (await db.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
    for (const [vendorId, cents, payee] of [[v.id, 120_000, "Pipe Pros"], [w.id, 70_000, "No W9 LLC"]] as const) {
      await createExpense(db, { payee, vendorId, date: "2026-03-03", bankAccountId: cash, lines: [{ accountId: rep, amountCents: cents, propertyId }] });
    }
    const f = await forms1099(ctx, 2026);
    expect(f.forms.map((x) => [x.name, x.amountCents, x.ready])).toEqual([["No W9 LLC", 70_000, false], ["Pipe Pros", 120_000, true]]);
    const csv = irisCsv(f);
    expect(csv).toContain("1099-NEC,2026,Test MONEY");
    expect(csv).toContain("ENTER FULL TIN (ends 6789),Pipe Pros,1 Pipe Rd,Chicago,IL,60602,1200.00,Yes,");
  });
});

describe("vendor invoices → bills → owner approval", () => {
  it("vendor submits, staff approves into a bill that needs owner sign-off before payment", async () => {
    const { setSetting } = await import("@/server/settings/service");
    const VI = await import("@/server/accounting/vendor-invoices");
    const { decideApproval } = await import("@/server/accounting/approvals");
    const { payBill } = await import("@/server/accounting/payables");
    const owner = await db.owner.create({ data: { organizationId: O.orgId, firstName: "Opal", lastName: "Owner", email: `opal-${O.orgId}@t.local` } });
    await db.propertyOwnership.create({ data: { organizationId: O.orgId, propertyId, ownerId: owner.id, percentBps: 10_000 } });
    await setSetting(db, "ownerPortal.approvalThresholdCents", "PROPERTY", propertyId, 100_000);
    const vendor = await db.vendor.create({ data: { organizationId: O.orgId, name: "Roof Co", userId: O.userId } });
    const task = await db.task.create({ data: { organizationId: O.orgId, number: 9001, title: "Patch roof", type: "WORK_ORDER", propertyId, vendorId: vendor.id } });
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], "inv.pdf", { type: "application/pdf" });
    const inv = await VI.submitVendorInvoice(db, vendor.id, { invoiceNumber: "R-1", invoiceDate: "2026-11-02", amountCents: 250_000, description: "Roof patch", taskId: task.id }, pdf);
    await expect(VI.submitVendorInvoice(db, vendor.id, { invoiceNumber: "R-1", invoiceDate: "2026-11-02", amountCents: 1, description: "dup" }, null)).rejects.toThrow(/already submitted|already invoiced/);
    const repairs = (await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } })).id;
    const bill = await VI.approveVendorInvoice(db, inv.id, { accountId: repairs, dueDate: "2026-11-30" });
    expect((await db.task.findFirstOrThrow({ where: { id: task.id } })).billId).toBe(bill.id);
    const approval = await db.ownerApproval.findFirstOrThrow({ where: { entityId: bill.id } });
    expect(approval).toMatchObject({ status: "PENDING", amountCents: 250_000 });
    expect(await admin.emailMessage.count({ where: { to: `opal-${O.orgId}@t.local`, subject: { startsWith: "Approval needed" } } })).toBe(1);
    const cash = (await db.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
    await expect(payBill(db, { billId: bill.id, date: "2026-11-05", bankAccountId: cash })).rejects.toThrow(/waiting for the owner/);
    await expect(decideApproval(db, approval.id, { name: "Stranger", propertyIds: [] }, "APPROVED")).rejects.toThrow(/not found/);
    await decideApproval(db, approval.id, { name: "Opal Owner", propertyIds: [propertyId] }, "APPROVED");
    await payBill(db, { billId: bill.id, date: "2026-11-05", bankAccountId: cash });
    expect((await db.bill.findFirstOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
  });
});
