"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, type ActionResult } from "@/server/action-result";
import * as AP from "@/server/accounting/payables";
import * as BK from "@/server/accounting/banking";
import * as OW from "@/server/accounting/owners";
import { parseBankCsv } from "@/adapters/bank-feed";
import { isoDate } from "@/lib/leasing";

/** Server actions for Phase 6 accounting. Each one checks the accounting permission level it needs. */
const done = () => revalidatePath("/app/accounting", "layout");

const line = z.object({
  accountId: z.string().min(1, "Choose an account"),
  amountCents: z.number().int().positive("Enter an amount"),
  description: z.string().max(200).optional(),
  propertyId: z.string().nullish(),
  unitId: z.string().nullish(),
});

const billSchema = z.object({
  vendorId: z.string().min(1, "Choose a vendor"),
  billNumber: z.string().trim().max(40).optional(),
  billDate: isoDate,
  dueDate: isoDate,
  memo: z.string().trim().max(200).optional(),
  lines: z.array(line).min(1, "Add a line"),
  recurring: z.object({ dayOfMonth: z.number().int().min(1).max(31) }).optional(),
});

export async function createBillAction(raw: z.input<typeof billSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const v = billSchema.parse(raw);
    const bill = await AP.createBill(ctx.db, v);
    if (v.recurring) {
      await AP.saveRecurringBill(ctx.db, null, { vendorId: v.vendorId, memo: v.memo, lines: v.lines, dayOfMonth: v.recurring.dayOfMonth, startDate: nextMonth(v.billDate) });
    }
    done();
    return bill;
  }, raw.recurring ? "Bill created — repeats monthly" : "Bill created");
}

function nextMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

const paySchema = z.object({ billId: z.string(), amountCents: z.number().int().positive().optional(), date: isoDate, bankAccountId: z.string().min(1, "Choose a bank account"), method: z.string().optional(), reference: z.string().max(40).optional() });
export async function payBillAction(raw: z.input<typeof paySchema>): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await AP.payBill(ctx.db, paySchema.parse(raw));
    done();
  }, "Payment recorded");
}

export async function payBillsAction(raw: { billIds: string[]; date: string; bankAccountId: string; method?: string }): Promise<ActionResult<{ count: number; totalCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const v = z.object({ billIds: z.array(z.string()).min(1, "Select bills"), date: isoDate, bankAccountId: z.string().min(1), method: z.string().optional() }).parse(raw);
    const r = await AP.payBills(ctx.db, v);
    done();
    return r;
  });
}

export async function voidBillAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    await AP.voidBill(ctx.db, id, z.string().trim().min(3, "Give a reason").parse(reason));
    done();
  }, "Bill voided");
}

export async function voidBillPaymentAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    await AP.voidBillPayment(ctx.db, id, z.string().trim().min(3, "Give a reason").parse(reason));
    done();
  }, "Payment voided");
}

const expenseSchema = z.object({
  payee: z.string().trim().min(1, "Who was paid?").max(120),
  vendorId: z.string().nullish(),
  date: isoDate,
  bankAccountId: z.string().min(1, "Choose a bank account"),
  method: z.string().optional(),
  reference: z.string().max(40).optional(),
  memo: z.string().max(200).optional(),
  lines: z.array(line).min(1, "Add a line"),
});
export async function createExpenseAction(raw: z.input<typeof expenseSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const e = await AP.createExpense(ctx.db, expenseSchema.parse(raw));
    done();
    return { id: e.id };
  }, "Expense recorded");
}

export async function voidExpenseAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    await AP.voidExpense(ctx.db, id, z.string().trim().min(3, "Give a reason").parse(reason));
    done();
  }, "Expense voided");
}

const creditSchema = z.object({ vendorId: z.string().min(1, "Choose a vendor"), date: isoDate, amountCents: z.number().int().positive("Enter an amount"), accountId: z.string().min(1, "Choose an account"), propertyId: z.string().nullish(), memo: z.string().max(200).optional(), applyToBillId: z.string().nullish() });
export async function createVendorCreditAction(raw: z.input<typeof creditSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await AP.createVendorCredit(ctx.db, creditSchema.parse(raw));
    done();
  }, "Vendor credit recorded");
}

export async function applyVendorCreditAction(creditId: string, billId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await AP.applyVendorCredit(ctx.db, creditId, billId);
    done();
  }, "Credit applied");
}

export async function setRecurringBillActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await ctx.db.recurringBill.update({ where: { id }, data: { active } });
    done();
  }, active ? "Recurring bill resumed" : "Recurring bill paused");
}

// ---------------------------------------------------------------- banking

export async function createDepositAction(raw: { bankAccountId: string; date: string; paymentIds: string[]; memo?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await BK.createDeposit(ctx.db, z.object({ bankAccountId: z.string().min(1), date: isoDate, paymentIds: z.array(z.string()).min(1, "Select payments"), memo: z.string().max(200).optional() }).parse(raw));
    done();
  }, "Deposit recorded");
}

export async function createTransferAction(raw: { fromAccountId: string; toAccountId: string; amountCents: number; date: string; propertyId?: string | null; memo?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const v = z.object({ fromAccountId: z.string().min(1, "Choose an account"), toAccountId: z.string().min(1, "Choose an account"), amountCents: z.number().int().positive("Enter an amount"), date: isoDate, propertyId: z.string().nullish(), memo: z.string().max(200).optional() }).parse(raw);
    await BK.createTransfer(ctx.db, v);
    done();
  }, "Transfer recorded");
}

export async function syncBankFeedAction(bankAccountId: string): Promise<ActionResult<{ fetched: number; added: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await BK.syncBankFeed(ctx.db, bankAccountId);
    done();
    return r;
  });
}

export async function importBankCsvAction(bankAccountId: string, rows: Record<string, string>[]): Promise<ActionResult<{ added: number; skipped: number; errors: { row: number; message: string }[] }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    if (rows.length > 5000) throw new Error("Import at most 5,000 rows at a time");
    const { ok, errors } = parseBankCsv(rows);
    const r = await BK.importBankCsv(ctx.db, bankAccountId, ok);
    done();
    return { ...r, errors };
  });
}

export async function matchBankTxnAction(txId: string, lineId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await BK.matchBankTransaction(ctx.db, txId, lineId);
    done();
  }, "Matched");
}

export async function categorizeBankTxnAction(txId: string, raw: { accountId: string; propertyId?: string | null; memo?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await BK.categorizeBankTransaction(ctx.db, txId, raw);
    done();
  }, "Categorized");
}

export async function ignoreBankTxnAction(txId: string, ignored: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await BK.setBankTransactionIgnored(ctx.db, txId, ignored);
    done();
  }, ignored ? "Excluded" : "Restored");
}

export async function startReconciliationAction(raw: { bankAccountId: string; statementDate: string; statementBalanceCents: number }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await BK.startReconciliation(ctx.db, z.object({ bankAccountId: z.string().min(1), statementDate: isoDate, statementBalanceCents: z.number().int() }).parse(raw));
    done();
    return { id: r.id };
  });
}

export async function completeReconciliationAction(recId: string, lineIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await BK.completeReconciliation(ctx.db, recId, lineIds);
    done();
  }, "Reconciliation complete");
}

export async function undoReconciliationAction(recId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    await BK.undoReconciliation(ctx.db, recId);
    done();
  }, "Reconciliation undone");
}

// ---------------------------------------------------------------- owners & fees

export async function distributeAction(raw: { propertyId: string; date: string; method?: string; memo?: string; amounts: { ownerId: string; amountCents: number }[] }): Promise<ActionResult<{ count: number; totalCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await OW.distribute(ctx.db, z.object({ propertyId: z.string(), date: isoDate, method: z.string().optional(), memo: z.string().max(200).optional(), amounts: z.array(z.object({ ownerId: z.string(), amountCents: z.number().int().min(0) })) }).parse(raw));
    done();
    return r;
  });
}

export async function distributeAllAction(propertyIds: string[], date: string): Promise<ActionResult<{ count: number; totalCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await OW.distributeAll(ctx.db, { propertyIds: z.array(z.string()).min(1, "Select properties").parse(propertyIds), date: isoDate.parse(date) });
    done();
    return r;
  });
}

export async function contributionAction(raw: { propertyId: string; ownerId: string; amountCents: number; date: string; memo?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    await OW.recordContribution(ctx.db, z.object({ propertyId: z.string(), ownerId: z.string().min(1, "Choose an owner"), amountCents: z.number().int().positive("Enter an amount"), date: isoDate, memo: z.string().max(200).optional() }).parse(raw));
    done();
  }, "Contribution recorded");
}

const ruleSchema = z.object({ propertyId: z.string().nullable(), type: z.enum(["PERCENT", "FLAT"]), percentBps: z.number().int().min(0).max(5000), flatCents: z.number().int().min(0), minimumCents: z.number().int().min(0), basis: z.enum(["COLLECTED_RENT", "COLLECTED_INCOME"]) });
export async function saveFeeRulesAction(rules: z.input<typeof ruleSchema>[]): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    await OW.saveFeeRules(ctx.db, z.array(ruleSchema).parse(rules));
    revalidatePath("/app/settings/management-fees");
    done();
  }, "Management fee rules saved");
}

export async function runManagementFeesAction(period: string): Promise<ActionResult<{ created: number; totalCents: number; skipped: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const r = await OW.runManagementFees(ctx.db, z.string().regex(/^\d{4}-\d{2}$/, "Choose a month").parse(period));
    done();
    return r;
  });
}

/** Email every owner last month's statement now (normally the nightly job does this on the 1st). */
export async function emailOwnerStatementsNow(): Promise<ActionResult<{ sent: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const { emailOwnerStatements } = await import("@/server/accounting/owner-statements");
    const { orgToday } = await import("@/server/leasing/queries");
    const sent = await emailOwnerStatements(ctx.db, await orgToday(ctx), { force: true });
    return { sent };
  });
}

// ─── Year-end close ───────────────────────────────────────────────────────

export async function closeYearAction(year: number): Promise<ActionResult<{ netIncomeCents: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    const { closeYear } = await import("@/server/accounting/close");
    const { orgToday } = await import("@/server/leasing/queries");
    const r = await closeYear(ctx.db, year, await orgToday(ctx));
    done();
    return { netIncomeCents: r.netIncomeCents };
  }, `${year} closed`);
}

export async function reopenYearAction(year: number): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    const { reopenYear } = await import("@/server/accounting/close");
    await reopenYear(ctx.db, year);
    done();
  }, `${year} reopened`);
}

// ─── Budgets ──────────────────────────────────────────────────────────────

export async function createBudgetAction(v: { name: string; year: number; propertyId: string | null; start: "BLANK" | "LAST_YEAR"; adjustPct?: number }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    if (v.propertyId && ctx.membership.propertyScope.length && !ctx.membership.propertyScope.includes(v.propertyId)) throw new Error("Forbidden");
    const { createBudget } = await import("@/server/accounting/budgets");
    const b = await createBudget(ctx, v);
    done();
    return { id: b.id };
  }, "Budget created");
}

export async function saveBudgetAction(id: string, amounts: Record<string, number[]>, name?: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const { saveBudgetAmounts } = await import("@/server/accounting/budgets");
    await saveBudgetAmounts(ctx.db, id, amounts, name);
    done();
  }, "Budget saved");
}

export async function deleteBudgetAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    await ctx.db.budget.update({ where: { id }, data: { deletedAt: new Date() } });
    done();
  }, "Budget deleted");
}

// ─── Utility billback (RUBS) ──────────────────────────────────────────────

type BillbackIn = import("@/server/accounting/billback").BillbackInput;
async function billbackCtx(v: BillbackIn) {
  const ctx = await requirePermission("accounting", "edit");
  const scope = ctx.membership.propertyScope;
  if (scope.length && !scope.includes(v.propertyId)) throw new Error("Forbidden");
  return ctx;
}

export async function previewBillbackAction(v: BillbackIn) {
  return runAction(async () => {
    const ctx = await billbackCtx(v);
    const { previewBillback } = await import("@/server/accounting/billback");
    return previewBillback(ctx.db, v);
  });
}

export async function postBillbackAction(v: BillbackIn): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await billbackCtx(v);
    const { postBillback } = await import("@/server/accounting/billback");
    const b = await postBillback(ctx.db, v);
    revalidatePath("/app", "layout");
    return { id: b.id };
  }, "Billback posted to the lease ledgers");
}

// ─── Vendor invoices ──────────────────────────────────────────────────────

/** Vendor login submits an invoice (FormData: invoiceNumber, invoiceDate, amountCents, description, taskId?, file?). */
export async function submitVendorInvoiceAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { requireContext } = await import("@/server/context");
    const ctx = await requireContext();
    const VI = await import("@/server/accounting/vendor-invoices");
    const vendor = await VI.vendorForUser(ctx.db, ctx.user.id);
    if (!vendor) throw new Error("Only vendor logins can submit invoices");
    const f = form.get("file");
    await VI.submitVendorInvoice(ctx.db, vendor.id, {
      invoiceNumber: String(form.get("invoiceNumber") ?? ""), invoiceDate: String(form.get("invoiceDate") ?? ""), amountCents: Number(form.get("amountCents") ?? 0),
      description: String(form.get("description") ?? ""), taskId: String(form.get("taskId") ?? "") || null,
    }, f instanceof File ? f : null);
    revalidatePath("/app", "layout");
  }, "Invoice submitted");
}

export async function approveVendorInvoiceAction(id: string, v: { accountId: string; propertyId?: string | null; dueDate: string }): Promise<ActionResult<{ billId: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const { approveVendorInvoice } = await import("@/server/accounting/vendor-invoices");
    const b = await approveVendorInvoice(ctx.db, id, v);
    done();
    return { billId: b.id };
  }, "Invoice approved — bill created");
}

export async function rejectVendorInvoiceAction(id: string, note: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const { rejectVendorInvoice } = await import("@/server/accounting/vendor-invoices");
    await rejectVendorInvoice(ctx.db, id, note);
    done();
  }, "Returned to the vendor");
}
