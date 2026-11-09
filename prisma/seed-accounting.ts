import { createNodePrisma } from "./node-client.mjs";
import { createScopedClient } from "../src/server/dal";
import { createBill, createExpense, createVendorCredit, payBill, saveRecurringBill } from "../src/server/accounting/payables";
import { completeReconciliation, createDeposit, createTransfer, reconciliationWorkspace, startReconciliation, syncBankFeed, undepositedPayments, bankBalance, categorizeBankTransaction } from "../src/server/accounting/banking";
import { distributeAll, runManagementFees, saveFeeRules } from "../src/server/accounting/owners";
import { addDays, addMonths, endOfMonth, periodOf, startOfMonth, toISODate } from "../src/lib/dates";

/**
 * Phase 6 demo data: weekly bank deposits, bills (paid, open, overdue), expenses, a recurring
 * bill, a vendor credit, management fee rules + 3 months of fee runs, owner distributions,
 * a synced bank feed and a completed reconciliation for last month.
 */
export async function seedAccounting(appUrl: string, orgId: string, adminUserId: string, today: Date) {
  const app = createNodePrisma(appUrl);
  const db = createScopedClient(app, { orgId, userId: adminUserId });
  const key = async (k: string) => (await db.account.findFirstOrThrow({ where: { systemKey: k } })).id;
  const named = async (n: string) => (await db.account.findFirstOrThrow({ where: { name: n } })).id;
  const cash = await key("OPERATING_CASH");
  const depositCash = await key("DEPOSIT_CASH");
  const A = { repairs: await key("REPAIRS"), utilities: await key("UTILITIES"), insurance: await key("INSURANCE"), taxes: await key("TAXES"), landscaping: await named("Landscaping"), cleaning: await named("Cleaning & Turnover"), bankFees: await named("Bank Fees"), otherIncome: await key("OTHER_INCOME") };
  await db.bankAccount.updateMany({ where: { accountId: cash }, data: { institution: "First Lakeshore Bank", mask: "4821" } });
  await db.bankAccount.updateMany({ where: { accountId: depositCash }, data: { institution: "First Lakeshore Bank", mask: "9934" } });

  // 1. Weekly deposits of everything received more than 4 days ago, into each property's own bank account.
  const bankOf = new Map((await db.property.findMany({ select: { id: true, defaultOperatingAccountId: true } })).map((p) => [p.id, p.defaultOperatingAccountId ?? cash]));
  const und = (await undepositedPayments(db)).filter((p) => p.date <= toISODate(addDays(today, -4)));
  const weeks = new Map<string, string[]>();
  for (const p of und) {
    const d = new Date(`${p.date}T00:00:00Z`);
    const friday = toISODate(addDays(d, (5 - d.getUTCDay() + 7) % 7));
    const k = `${friday > toISODate(today) ? toISODate(today) : friday}|${bankOf.get(p.propertyId) ?? cash}`;
    weeks.set(k, [...(weeks.get(k) ?? []), p.id]);
  }
  for (const [k, ids] of [...weeks].sort()) {
    const [date, bank] = k.split("|") as [string, string];
    await createDeposit(db, { bankAccountId: bank, date, paymentIds: ids, memo: `Weekly deposit — ${ids.length} payments` });
  }

  // 2. Properties, vendors.
  const props = await db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, units: { select: { id: true } } } });
  const vendors = await db.vendor.findMany();
  const v = (n: string) => vendors.find((x) => x.name.startsWith(n))!.id;
  const utilityCo = (await db.vendor.create({ data: { organizationId: orgId, name: "ComEd Utilities", email: "billing@comed.example.com", trades: [], send1099: false, defaultExpenseAccountId: A.utilities, createdById: adminUserId } })).id;
  const insurer = (await db.vendor.create({ data: { organizationId: orgId, name: "Lakeshore Mutual Insurance", email: "policy@lakeshoremutual.example.com", trades: [], send1099: false, defaultExpenseAccountId: A.insurance, createdById: adminUserId } })).id;

  // 3. Monthly landscaping + utilities bills for the last 6 months (paid), plus open / overdue ones.
  for (let m = 6; m >= 1; m--) {
    const billDate = addDays(startOfMonth(addMonths(today, -m)), 4);
    const b1 = await createBill(db, { vendorId: v("Green Thumb"), billNumber: `GT-${periodOf(billDate)}`, billDate: toISODate(billDate), dueDate: toISODate(addDays(billDate, 20)), memo: "Monthly grounds service", lines: props.slice(0, 6).map((p) => ({ accountId: A.landscaping, amountCents: 18_500, propertyId: p.id })) });
    await payBill(db, { billId: b1.id, date: toISODate(addDays(billDate, 15)), bankAccountId: cash, method: "ACH" }); // company pays shared vendors from operating
    const b2 = await createBill(db, { vendorId: utilityCo, billNumber: `CE-${periodOf(billDate)}`, billDate: toISODate(billDate), dueDate: toISODate(addDays(billDate, 21)), memo: "Common-area electric", lines: props.slice(0, 4).map((p, i) => ({ accountId: A.utilities, amountCents: 9_200 + i * 1_350 + m * 210, propertyId: p.id })) });
    await payBill(db, { billId: b2.id, date: toISODate(addDays(billDate, 18)), bankAccountId: cash, method: "ACH" });
  }
  const thisMonth = addDays(startOfMonth(today), 2);
  await createBill(db, { vendorId: utilityCo, billNumber: `CE-${periodOf(today)}`, billDate: toISODate(thisMonth), dueDate: toISODate(addDays(today, 6)), memo: "Common-area electric", lines: props.slice(0, 4).map((p, i) => ({ accountId: A.utilities, amountCents: 10_400 + i * 1_100, propertyId: p.id })) });
  await createBill(db, { vendorId: insurer, billNumber: "LM-88412", billDate: toISODate(addDays(today, -40)), dueDate: toISODate(addDays(today, -10)), memo: "Annual umbrella policy (overdue)", lines: props.map((p) => ({ accountId: A.insurance, amountCents: 42_000, propertyId: p.id })) });
  const sparkle = await createBill(db, { vendorId: v("Sparkle"), billNumber: "SC-5521", billDate: toISODate(addDays(today, -12)), dueDate: toISODate(addDays(today, 18)), memo: "Turnover cleaning", lines: [{ accountId: A.cleaning, amountCents: 32_500, propertyId: props[0]!.id, unitId: props[0]!.units[0]?.id }] });
  await payBill(db, { billId: sparkle.id, amountCents: 12_500, date: toISODate(addDays(today, -5)), bankAccountId: cash, method: "CHECK", reference: "2047" });
  const pest = await createBill(db, { vendorId: v("Bug-Off"), billNumber: "BO-1180", billDate: toISODate(addDays(today, -8)), dueDate: toISODate(addDays(today, 22)), memo: "Quarterly pest treatment", lines: props.slice(0, 3).map((p) => ({ accountId: A.repairs, amountCents: 9_500, propertyId: p.id })) });
  await createVendorCredit(db, { vendorId: v("Bug-Off"), date: toISODate(addDays(today, -6)), amountCents: 4_500, accountId: A.repairs, propertyId: props[0]!.id, memo: "Missed visit — credit", applyToBillId: pest.id });

  // 4. A recurring bill (property tax installment) — next one created by the nightly job.
  await saveRecurringBill(db, null, { vendorId: insurer, memo: "Monthly insurance premium", lines: props.slice(0, 2).map((p) => ({ accountId: A.insurance, amountCents: 11_000, propertyId: p.id })), dayOfMonth: 15, startDate: toISODate(addDays(today, 1)) });

  // 5. Expenses paid by card.
  const exp = [
    { payee: "Home Depot", days: -32, lines: [{ accountId: A.repairs, amountCents: 8_642, propertyId: props[1]!.id }], method: "DEBIT_CARD" },
    { payee: "Lowe's", days: -19, lines: [{ accountId: A.repairs, amountCents: 12_917, propertyId: props[2]!.id }], method: "DEBIT_CARD" },
    { payee: "City of Chicago — Water", days: -14, lines: props.slice(0, 3).map((p, i) => ({ accountId: A.utilities, amountCents: 6_100 + i * 800, propertyId: p.id })), method: "ACH" },
    { payee: "Ace Hardware", days: -3, lines: [{ accountId: A.repairs, amountCents: 2_399, propertyId: props[3]!.id }], method: "CREDIT_CARD" },
  ];
  for (const e of exp) await createExpense(db, { payee: e.payee, date: toISODate(addDays(today, e.days)), bankAccountId: cash, method: e.method, lines: e.lines });

  // 6. Management fees: 8% of collected rent (min $50); a flat-fee override for the first single-family home.
  const sfh = await db.property.findFirst({ where: { type: "SINGLE_FAMILY" }, orderBy: { name: "asc" } });
  await saveFeeRules(db, [
    { propertyId: null, type: "PERCENT", percentBps: 800, flatCents: 0, minimumCents: 5_000, basis: "COLLECTED_RENT" },
    ...(sfh ? [{ propertyId: sfh.id, type: "FLAT" as const, percentBps: 0, flatCents: 12_500, minimumCents: 0, basis: "COLLECTED_RENT" as const }] : []),
  ]);
  for (let m = 3; m >= 1; m--) await runManagementFees(db, periodOf(addMonths(today, -m)));

  // 7. Owner distributions for last month (keep a reserve on a couple of properties).
  await db.property.updateMany({ where: { id: { in: props.slice(0, 2).map((p) => p.id) } }, data: { reserveCents: 50_000 } });
  await distributeAll(db, { propertyIds: props.slice(0, 8).map((p) => p.id), date: toISODate(endOfMonth(addMonths(today, -1))) });

  // 8. A transfer to fund the security deposit account.
  await createTransfer(db, { fromAccountId: cash, toAccountId: depositCash, amountCents: 25_000, date: toISODate(addDays(today, -9)), memo: "Top up deposit trust account" });

  // 9. Bank feed + reconciliation of last month.
  await syncBankFeed(db, cash, today);
  const fees = await db.bankTransaction.findMany({ where: { bankAccountId: cash, status: "UNMATCHED", description: "MONTHLY SERVICE FEE", date: { lt: startOfMonth(today) } } });
  for (const f of fees) await categorizeBankTransaction(db, f.id, { accountId: A.bankFees });
  const interest = await db.bankTransaction.findMany({ where: { bankAccountId: cash, status: "UNMATCHED", description: "INTEREST PAYMENT", date: { lt: startOfMonth(today) } } });
  for (const i of interest) await categorizeBankTransaction(db, i.id, { accountId: A.otherIncome });
  const stmt = endOfMonth(addMonths(today, -1));
  const rec = await startReconciliation(db, { bankAccountId: cash, statementDate: toISODate(stmt), statementBalanceCents: await bankBalance(db, cash, stmt) });
  const ws = await reconciliationWorkspace(db, rec.id);
  await completeReconciliation(db, rec.id, ws.lines.map((l) => l.id));

  const counts = { deposits: await db.deposit.count(), bills: await db.bill.count(), expenses: await db.expense.count(), feed: await db.bankTransaction.count(), distributions: await db.ownerDistribution.count(), feeRuns: await db.managementFeeRun.count() };
  await app.$disconnect();
  return counts;
}
