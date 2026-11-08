import type { ScopedDb, ScopedTx } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { AccountResolver, postEntry, reverseEntry } from "@/server/ledger/journal";
import { billPaymentLines, expenseLines, vendorCreditLines } from "@/server/ledger/postings";
import { createBill, type BillInput } from "@/server/maintenance/bills";
import { addDays, addMonths, parseISODate, periodOf, toISODate, utcDate, daysInMonth } from "@/lib/dates";
import { allocateCents } from "@/lib/money";

export { createBill, type BillInput };

type Actor = { orgId: string; userId: string | null };

/** What's still owed on a bill = total − payments − vendor credits applied. */
export async function billOpenCents(tx: ScopedTx | ScopedDb, billId: string): Promise<number> {
  const [bill, paid, credits] = await Promise.all([
    tx.bill.findFirst({ where: { id: billId }, select: { totalCents: true, status: true } }),
    tx.billPayment.aggregate({ where: { billId, voidedAt: null }, _sum: { amountCents: true } }),
    tx.vendorCredit.aggregate({ where: { appliedToBillId: billId }, _sum: { amountCents: true } }),
  ]);
  if (!bill || bill.status === "VOID") return 0;
  return bill.totalCents - (paid._sum.amountCents ?? 0) - (credits._sum.amountCents ?? 0);
}

async function refreshStatus(tx: ScopedTx, billId: string) {
  const bill = await tx.bill.findFirstOrThrow({ where: { id: billId } });
  if (bill.status === "VOID" || bill.status === "DRAFT") return;
  const open = await billOpenCents(tx, billId);
  const status = open <= 0 ? "PAID" : open < bill.totalCents ? "PARTIALLY_PAID" : "OPEN";
  if (status !== bill.status) await tx.bill.update({ where: { id: billId }, data: { status } });
}

/** Split an amount across a bill's properties in proportion to its lines. */
async function billSplit(tx: ScopedTx, billId: string, amountCents: number) {
  const lines = await tx.billLine.findMany({ where: { billId }, select: { propertyId: true, amountCents: true } });
  const groups = new Map<string | null, number>();
  for (const l of lines) groups.set(l.propertyId, (groups.get(l.propertyId) ?? 0) + l.amountCents);
  const keys = [...groups.keys()];
  const parts = allocateCents(amountCents, keys.map((k) => groups.get(k)!));
  return keys.map((propertyId, i) => ({ propertyId, amountCents: parts[i]! })).filter((p) => p.amountCents > 0);
}

export async function bankAccounts(db: ScopedDb | ScopedTx) {
  const accts = await db.account.findMany({ where: { isBank: true, active: true }, orderBy: { code: "asc" }, include: { bankAccount: true } });
  return accts.map((a) => ({ id: a.id, code: a.code, name: a.name, systemKey: a.systemKey, purpose: a.bankAccount?.purpose ?? "OPERATING", mask: a.bankAccount?.mask ?? null, institution: a.bankAccount?.institution ?? null }));
}

async function assertBank(tx: ScopedTx | ScopedDb, accountId: string) {
  const a = await tx.account.findFirst({ where: { id: accountId, isBank: true } });
  if (!a) throw new UserFacingError("Choose a bank account", { bankAccountId: "Choose a bank account" });
  return a;
}

export type PayBillInput = { billId: string; amountCents?: number; date: string; bankAccountId: string; method?: string; reference?: string };

export async function payBillInTx(tx: ScopedTx, a: Actor, input: PayBillInput) {
  const bill = await tx.bill.findFirst({ where: { id: input.billId }, include: { vendor: true } });
  if (!bill) throw new UserFacingError("Bill not found");
  if (bill.status === "VOID") throw new UserFacingError("This bill was voided");
  const { assertBillApproved } = await import("./approvals");
  await assertBillApproved(tx, bill.id);
  const open = await billOpenCents(tx, bill.id);
  if (open <= 0) throw new UserFacingError(`Bill ${bill.billNumber ? `#${bill.billNumber} ` : ""}is already paid`);
  const amount = input.amountCents ?? open;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Enter an amount" });
  if (amount > open) throw new UserFacingError(`That's more than the ${(open / 100).toFixed(2)} still owed`, { amountCents: "More than what's owed" });
  await assertBank(tx, input.bankAccountId);
  const date = parseISODate(input.date);
  const je = await postEntry(tx, a.orgId, a.userId, {
    date,
    memo: `Bill payment — ${bill.vendor.name}${bill.billNumber ? ` #${bill.billNumber}` : ""}`,
    source: "BILL_PAYMENT",
    sourceId: bill.id,
    lines: billPaymentLines(amount, { id: input.bankAccountId }, {}, await billSplit(tx, bill.id, amount)),
  });
  const p = await tx.billPayment.create({
    data: { organizationId: a.orgId, billId: bill.id, amountCents: amount, date, bankAccountId: input.bankAccountId, method: input.method ?? "CHECK", reference: input.reference || null, journalEntryId: je.id, createdById: a.userId },
  });
  await refreshStatus(tx, bill.id);
  return p;
}

export async function payBill(db: ScopedDb, input: PayBillInput) {
  const p = await db.tx((tx) => payBillInTx(tx, db.ctx, input));
  await audit(db, { action: "bill.paid", entityType: "Bill", entityId: input.billId, after: { amountCents: p.amountCents, bankAccountId: input.bankAccountId } });
  return p;
}

/** Pay several bills in full, each in its own entry, all-or-nothing. */
export async function payBills(db: ScopedDb, input: { billIds: string[]; date: string; bankAccountId: string; method?: string }) {
  if (!input.billIds.length) throw new UserFacingError("Select bills to pay");
  const res = await db.tx(async (tx) => {
    let total = 0;
    for (const billId of input.billIds) {
      const p = await payBillInTx(tx, db.ctx, { billId, date: input.date, bankAccountId: input.bankAccountId, method: input.method });
      total += p.amountCents;
    }
    return { count: input.billIds.length, totalCents: total };
  }, { timeout: 60_000 });
  await audit(db, { action: "bill.bulk_paid", entityType: "Bill", after: { ...res, billIds: input.billIds } });
  return res;
}

export async function voidBillPayment(db: ScopedDb, paymentId: string, reason: string) {
  const p = await db.billPayment.findFirst({ where: { id: paymentId } });
  if (!p) throw new UserFacingError("Payment not found");
  if (p.voidedAt) throw new UserFacingError("Already voided");
  await db.tx(async (tx) => {
    await reverseEntry(tx, db.ctx.orgId, db.ctx.userId, p.journalEntryId, new Date(), `Void bill payment — ${reason}`);
    await tx.billPayment.update({ where: { id: p.id }, data: { voidedAt: new Date() } });
    await refreshStatus(tx, p.billId);
  });
  await audit(db, { action: "bill_payment.voided", entityType: "Bill", entityId: p.billId, after: { paymentId, reason } });
}

export async function voidBill(db: ScopedDb, billId: string, reason: string) {
  const bill = await db.bill.findFirst({ where: { id: billId } });
  if (!bill) throw new UserFacingError("Bill not found");
  if (bill.status === "VOID") throw new UserFacingError("Already voided");
  if (await db.billPayment.count({ where: { billId, voidedAt: null } })) throw new UserFacingError("Void the bill's payments first");
  if (await db.vendorCredit.count({ where: { appliedToBillId: billId } })) throw new UserFacingError("Unapply vendor credits first");
  await db.tx(async (tx) => {
    if (bill.journalEntryId) await reverseEntry(tx, db.ctx.orgId, db.ctx.userId, bill.journalEntryId, new Date(), `Void bill — ${reason}`);
    await tx.bill.update({ where: { id: billId }, data: { status: "VOID" } });
    if (bill.taskId) await tx.task.updateMany({ where: { id: bill.taskId, billId }, data: { billId: null } });
  });
  await audit(db, { action: "bill.voided", entityType: "Bill", entityId: billId, after: { reason } });
}

// ---------------------------------------------------------------- expenses

export type ExpenseInput = {
  payee: string;
  vendorId?: string | null;
  date: string;
  bankAccountId: string;
  method?: string;
  reference?: string;
  memo?: string;
  lines: { accountId: string; amountCents: number; description?: string; propertyId?: string | null; unitId?: string | null }[];
};

async function assertExpenseLines(db: ScopedDb | ScopedTx, lines: ExpenseInput["lines"]) {
  if (!lines.length) throw new UserFacingError("Add at least one line");
  if (lines.some((l) => !Number.isSafeInteger(l.amountCents) || l.amountCents <= 0)) throw new UserFacingError("Every line needs an amount", { lines: "Enter amounts" });
  const accounts = await db.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) } } });
  for (const l of lines) {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a || !["EXPENSE", "ASSET"].includes(a.type) || a.isBank) throw new UserFacingError("Expense lines post to expense accounts", { lines: "Choose expense accounts" });
  }
  const props = [...new Set(lines.map((l) => l.propertyId).filter((x): x is string => !!x))];
  if (props.length && (await db.property.count({ where: { id: { in: props } } })) !== props.length) throw new UserFacingError("Choose valid properties");
}

export async function createExpense(db: ScopedDb, input: ExpenseInput) {
  if (!input.payee.trim()) throw new UserFacingError("Who was paid?", { payee: "Required" });
  await assertExpenseLines(db, input.lines);
  await assertBank(db, input.bankAccountId);
  if (input.vendorId && !(await db.vendor.findFirst({ where: { id: input.vendorId } }))) throw new UserFacingError("Choose a valid vendor");
  const total = input.lines.reduce((s, l) => s + l.amountCents, 0);
  const exp = await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: parseISODate(input.date),
      memo: `Expense — ${input.payee}${input.memo ? `: ${input.memo}` : ""}`,
      source: "EXPENSE",
      lines: expenseLines(input.lines.map((l) => ({ account: { id: l.accountId }, amountCents: l.amountCents, dims: { propertyId: l.propertyId ?? null, unitId: l.unitId ?? null } })), { id: input.bankAccountId }),
    });
    const e = await tx.expense.create({
      data: {
        organizationId: db.ctx.orgId, vendorId: input.vendorId || null, payee: input.payee.trim(), date: parseISODate(input.date), bankAccountId: input.bankAccountId,
        method: input.method ?? "DEBIT_CARD", reference: input.reference || null, memo: input.memo || null, totalCents: total, journalEntryId: je.id, createdById: db.ctx.userId,
        lines: { create: input.lines.map((l) => ({ organizationId: db.ctx.orgId, accountId: l.accountId, amountCents: l.amountCents, description: l.description || null, propertyId: l.propertyId || null, unitId: l.unitId || null })) },
      },
    });
    await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: e.id } });
    return e;
  });
  await audit(db, { action: "expense.created", entityType: "Expense", entityId: exp.id, after: { payee: input.payee, total } });
  return exp;
}

export async function voidExpense(db: ScopedDb, id: string, reason: string) {
  const e = await db.expense.findFirst({ where: { id } });
  if (!e) throw new UserFacingError("Expense not found");
  if (e.voidedAt) throw new UserFacingError("Already voided");
  await db.tx(async (tx) => {
    await reverseEntry(tx, db.ctx.orgId, db.ctx.userId, e.journalEntryId, new Date(), `Void expense — ${reason}`);
    await tx.expense.update({ where: { id }, data: { voidedAt: new Date() } });
  });
  await audit(db, { action: "expense.voided", entityType: "Expense", entityId: id, after: { reason } });
}

// ---------------------------------------------------------------- vendor credits

export async function createVendorCredit(db: ScopedDb, input: { vendorId: string; date: string; amountCents: number; accountId: string; propertyId?: string | null; memo?: string; applyToBillId?: string | null }) {
  const vendor = await db.vendor.findFirst({ where: { id: input.vendorId } });
  if (!vendor) throw new UserFacingError("Choose a vendor", { vendorId: "Choose a vendor" });
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Enter an amount" });
  const acct = await db.account.findFirst({ where: { id: input.accountId } });
  if (!acct || acct.type !== "EXPENSE") throw new UserFacingError("Credits reduce an expense account", { accountId: "Choose an expense account" });
  if (input.propertyId && !(await db.property.findFirst({ where: { id: input.propertyId } }))) throw new UserFacingError("Choose a valid property");
  const credit = await db.tx(async (tx) => {
    if (input.applyToBillId) {
      const bill = await tx.bill.findFirst({ where: { id: input.applyToBillId } });
      if (!bill || bill.vendorId !== vendor.id) throw new UserFacingError("Apply the credit to one of this vendor's bills");
      if (input.amountCents > (await billOpenCents(tx, bill.id))) throw new UserFacingError("The credit is more than the bill's open balance", { amountCents: "More than the bill's balance" });
    }
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: parseISODate(input.date),
      memo: `Vendor credit — ${vendor.name}${input.memo ? `: ${input.memo}` : ""}`,
      source: "VENDOR_CREDIT",
      lines: vendorCreditLines(input.amountCents, { id: acct.id }, { propertyId: input.propertyId ?? null }),
    });
    const c = await tx.vendorCredit.create({
      data: { organizationId: db.ctx.orgId, vendorId: vendor.id, date: parseISODate(input.date), amountCents: input.amountCents, accountId: acct.id, propertyId: input.propertyId || null, memo: input.memo || null, appliedToBillId: input.applyToBillId || null, journalEntryId: je.id, createdById: db.ctx.userId },
    });
    await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: c.id } });
    if (input.applyToBillId) await refreshStatus(tx, input.applyToBillId);
    return c;
  });
  await audit(db, { action: "vendor_credit.created", entityType: "VendorCredit", entityId: credit.id, after: input });
  return credit;
}

export async function applyVendorCredit(db: ScopedDb, creditId: string, billId: string) {
  await db.tx(async (tx) => {
    const c = await tx.vendorCredit.findFirst({ where: { id: creditId } });
    if (!c) throw new UserFacingError("Credit not found");
    if (c.appliedToBillId) throw new UserFacingError("This credit is already applied");
    const bill = await tx.bill.findFirst({ where: { id: billId } });
    if (!bill || bill.vendorId !== c.vendorId) throw new UserFacingError("Apply the credit to one of this vendor's bills");
    if (c.amountCents > (await billOpenCents(tx, billId))) throw new UserFacingError("The credit is more than the bill's open balance");
    await tx.vendorCredit.update({ where: { id: creditId }, data: { appliedToBillId: billId } });
    await refreshStatus(tx, billId);
  });
  await audit(db, { action: "vendor_credit.applied", entityType: "VendorCredit", entityId: creditId, after: { billId } });
}

// ---------------------------------------------------------------- recurring bills

export type RecurringLine = { accountId: string; amountCents: number; propertyId?: string | null; unitId?: string | null; description?: string };

function nextOnDay(from: Date, day: number): Date {
  const clamp = (y: number, m: number) => utcDate(y, m, Math.min(day, daysInMonth(utcDate(y, m, 1))));
  const thisMonth = clamp(from.getUTCFullYear(), from.getUTCMonth());
  if (thisMonth >= from) return thisMonth;
  const n = addMonths(utcDate(from.getUTCFullYear(), from.getUTCMonth(), 1), 1);
  return clamp(n.getUTCFullYear(), n.getUTCMonth());
}

export async function saveRecurringBill(db: ScopedDb, id: string | null, input: { vendorId: string; memo?: string; lines: RecurringLine[]; dayOfMonth: number; dueDays?: number; startDate: string; endDate?: string | null; active?: boolean }) {
  if (!(await db.vendor.findFirst({ where: { id: input.vendorId } }))) throw new UserFacingError("Choose a vendor", { vendorId: "Choose a vendor" });
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) throw new UserFacingError("Day of month must be 1–31", { dayOfMonth: "1–31" });
  await assertExpenseLines(db, input.lines);
  const data = {
    vendorId: input.vendorId, memo: input.memo || null, lines: input.lines, dayOfMonth: input.dayOfMonth, dueDays: input.dueDays ?? 15,
    nextRunDate: nextOnDay(parseISODate(input.startDate), input.dayOfMonth), endDate: input.endDate ? parseISODate(input.endDate) : null, active: input.active ?? true,
  };
  const r = id ? await db.recurringBill.update({ where: { id }, data }) : await db.recurringBill.create({ data: { organizationId: db.ctx.orgId, createdById: db.ctx.userId, ...data } });
  await audit(db, { action: id ? "recurring_bill.updated" : "recurring_bill.created", entityType: "RecurringBill", entityId: r.id, after: data });
  return r;
}

/** Nightly: create every recurring bill due through `today`. Idempotent per (recurring bill, period). */
export async function runRecurringBills(db: ScopedDb, today: Date): Promise<number> {
  const due = await db.recurringBill.findMany({ where: { active: true, nextRunDate: { lte: today } } });
  let created = 0;
  for (const r of due) {
    let run = r.nextRunDate;
    while (run <= today && (!r.endDate || run <= r.endDate)) {
      const period = periodOf(run);
      const done = await db.recurringBillRun.findFirst({ where: { recurringBillId: r.id, period } });
      if (!done) {
        const lines = r.lines as RecurringLine[];
        const bill = await createBill(db, { vendorId: r.vendorId, billNumber: `AUTO-${period}`, billDate: toISODate(run), dueDate: toISODate(addDays(run, r.dueDays)), memo: r.memo ?? "Recurring bill", lines });
        await db.recurringBillRun.create({ data: { organizationId: db.ctx.orgId, recurringBillId: r.id, period, billId: bill.id } });
        created++;
      }
      run = nextOnDay(addDays(run, 1), r.dayOfMonth);
    }
    await db.recurringBill.update({ where: { id: r.id }, data: { nextRunDate: run, active: !r.endDate || run <= r.endDate } });
  }
  return created;
}

/** Re-export so callers can resolve system accounts without importing the ledger directly. */
export { AccountResolver };
