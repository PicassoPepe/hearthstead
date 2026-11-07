/**
 * Pure posting rules. Every financial action is expressed as balanced journal lines.
 * Accounts are referenced by system key (resolved to ids at write time) or by id.
 */
export type AccountRef = { key: SystemKey } | { id: string };
export type SystemKey =
  | "OPERATING_CASH" | "DEPOSIT_CASH" | "ACCOUNTS_RECEIVABLE" | "UNDEPOSITED_FUNDS" | "ACCOUNTS_PAYABLE" | "DEPOSITS_HELD"
  | "PREPAID_RENT" | "OWNER_EQUITY" | "OWNER_CONTRIBUTIONS" | "OWNER_DISTRIBUTIONS" | "RENT_INCOME" | "LATE_FEE_INCOME"
  | "OTHER_INCOME" | "MANAGEMENT_FEE_INCOME" | "NSF_FEE_INCOME" | "APPLICATION_FEE_INCOME" | "OPENING_BALANCE_EQUITY"
  | "REPAIRS" | "UTILITIES" | "INSURANCE" | "TAXES" | "MANAGEMENT_FEES" | "RETAINED_EARNINGS";

export type Dims = { propertyId?: string | null; unitId?: string | null; leaseId?: string | null };
export type Line = { account: AccountRef; debitCents: number; creditCents: number; memo?: string } & Dims;

export class UnbalancedEntryError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UnbalancedEntryError";
  }
}

const dr = (account: AccountRef, cents: number, dims: Dims): Line => ({ account, debitCents: cents, creditCents: 0, ...dims });
const cr = (account: AccountRef, cents: number, dims: Dims): Line => ({ account, debitCents: 0, creditCents: cents, ...dims });
const nonZero = (lines: Line[]) => lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0);

/** Throws unless every line is a non-negative integer on exactly one side and debits == credits > 0. */
export function assertBalanced(lines: Line[]): void {
  if (lines.length < 2) throw new UnbalancedEntryError("An entry needs at least two lines");
  let d = 0;
  let c = 0;
  for (const l of lines) {
    for (const v of [l.debitCents, l.creditCents]) {
      if (!Number.isSafeInteger(v) || v < 0) throw new UnbalancedEntryError("Amounts must be non-negative integer cents");
    }
    if ((l.debitCents > 0) === (l.creditCents > 0)) throw new UnbalancedEntryError("Each line must be either a debit or a credit");
    d += l.debitCents;
    c += l.creditCents;
  }
  if (d !== c) throw new UnbalancedEntryError(`Debits (${d}) must equal credits (${c})`);
  if (d === 0) throw new UnbalancedEntryError("Entry total must be greater than zero");
}

function positive(cents: number, what: string) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RangeError(`${what} must be a positive amount`);
}

/** Charge: Dr A/R, Cr income (or Deposits Held when billing a security deposit). */
export function chargeLines(amountCents: number, incomeAccount: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Charge");
  return [dr({ key: "ACCOUNTS_RECEIVABLE" }, amountCents, dims), cr(incomeAccount, amountCents, dims)];
}

/** Payment: Dr Undeposited Funds/Bank, Cr A/R for what's applied, Cr Prepaid Rent for the excess. */
export function paymentLines(amountCents: number, appliedCents: number, depositTo: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Payment");
  if (appliedCents < 0 || appliedCents > amountCents) throw new RangeError("Applied amount out of range");
  return nonZero([
    dr(depositTo, amountCents, dims),
    cr({ key: "ACCOUNTS_RECEIVABLE" }, appliedCents, dims),
    cr({ key: "PREPAID_RENT" }, amountCents - appliedCents, dims),
  ]);
}

/** Credit (concession/write-off): Dr the credit account, Cr A/R (excess → Prepaid Rent). */
export function creditLines(amountCents: number, appliedCents: number, creditAccount: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Credit");
  if (appliedCents < 0 || appliedCents > amountCents) throw new RangeError("Applied amount out of range");
  return nonZero([
    dr(creditAccount, amountCents, dims),
    cr({ key: "ACCOUNTS_RECEIVABLE" }, appliedCents, dims),
    cr({ key: "PREPAID_RENT" }, amountCents - appliedCents, dims),
  ]);
}

/** Apply existing prepaid balance to charges: Dr Prepaid Rent, Cr A/R. */
export function prepaidApplicationLines(amountCents: number, dims: Dims): Line[] {
  positive(amountCents, "Prepaid application");
  return [dr({ key: "PREPAID_RENT" }, amountCents, dims), cr({ key: "ACCOUNTS_RECEIVABLE" }, amountCents, dims)];
}

/** Move money that was applied to a voided charge back to Prepaid: Dr A/R, Cr Prepaid Rent. */
export function unapplyLines(amountCents: number, dims: Dims): Line[] {
  positive(amountCents, "Unapplied amount");
  return [dr({ key: "ACCOUNTS_RECEIVABLE" }, amountCents, dims), cr({ key: "PREPAID_RENT" }, amountCents, dims)];
}

/** Security deposit collected: Dr Deposit Cash, Cr Security Deposits Held. */
export function depositLines(amountCents: number, depositCash: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Deposit");
  return [dr(depositCash, amountCents, dims), cr({ key: "DEPOSITS_HELD" }, amountCents, dims)];
}

/** Deposit refund: Dr Security Deposits Held, Cr Deposit Cash. */
export function depositRefundLines(amountCents: number, depositCash: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Refund");
  return [dr({ key: "DEPOSITS_HELD" }, amountCents, dims), cr(depositCash, amountCents, dims)];
}

/** Overpayment refund: Dr Prepaid Rent, Cr Bank. */
export function prepaidRefundLines(amountCents: number, bank: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Refund");
  return [dr({ key: "PREPAID_RENT" }, amountCents, dims), cr(bank, amountCents, dims)];
}

/**
 * Returned (bounced) payment. Everything the payment paid off reopens:
 * Dr A/R (all amounts it had applied, directly or later from prepaid),
 * Dr Prepaid Rent (whatever is still unapplied), Cr the account it was deposited to.
 */
export function returnedPaymentLines(amountCents: number, appliedCents: number, depositedTo: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Returned payment");
  if (appliedCents < 0 || appliedCents > amountCents) throw new RangeError("Applied amount out of range");
  return nonZero([
    dr({ key: "ACCOUNTS_RECEIVABLE" }, appliedCents, dims),
    dr({ key: "PREPAID_RENT" }, amountCents - appliedCents, dims),
    cr(depositedTo, amountCents, dims),
  ]);
}

type Split = { account: AccountRef; amountCents: number; dims: Dims };

/** Group amounts by property so the balancing side carries the same property dimension. */
function byProperty(lines: { amountCents: number; dims: Dims }[]): { propertyId: string | null; amountCents: number }[] {
  const m = new Map<string | null, number>();
  for (const l of lines) m.set(l.dims.propertyId ?? null, (m.get(l.dims.propertyId ?? null) ?? 0) + l.amountCents);
  return [...m].map(([propertyId, amountCents]) => ({ propertyId, amountCents }));
}

function assertSplits(lines: Split[], what: string) {
  if (!lines.length) throw new RangeError(`${what} needs at least one line`);
  for (const l of lines) positive(l.amountCents, `${what} line`);
}

/** Bill: Dr expense lines, Cr A/P (per property, so payables can be tracked by property). */
export function billLines(lines: Split[]): Line[] {
  assertSplits(lines, "Bill");
  return [...lines.map((l) => dr(l.account, l.amountCents, l.dims)), ...byProperty(lines).map((g) => cr({ key: "ACCOUNTS_PAYABLE" }, g.amountCents, { propertyId: g.propertyId }))];
}

/** Pay bill: Dr A/P, Cr Bank — split across the bill's properties. */
export function billPaymentLines(amountCents: number, bank: AccountRef, dims: Dims = {}, split?: { propertyId: string | null; amountCents: number }[]): Line[] {
  positive(amountCents, "Bill payment");
  const parts = split?.length ? split : [{ propertyId: dims.propertyId ?? null, amountCents }];
  if (parts.reduce((s, p) => s + p.amountCents, 0) !== amountCents) throw new RangeError("Payment split must add up to the payment");
  return nonZero(parts.flatMap((p) => [dr({ key: "ACCOUNTS_PAYABLE" }, p.amountCents, { propertyId: p.propertyId }), cr(bank, p.amountCents, { propertyId: p.propertyId })]));
}

/** Expense paid directly from a bank account / card: Dr expense lines, Cr bank (per property). */
export function expenseLines(lines: Split[], bank: AccountRef): Line[] {
  assertSplits(lines, "Expense");
  return [...lines.map((l) => dr(l.account, l.amountCents, l.dims)), ...byProperty(lines).map((g) => cr(bank, g.amountCents, { propertyId: g.propertyId }))];
}

/** Vendor credit: Dr A/P, Cr the expense it refunds. */
export function vendorCreditLines(amountCents: number, expense: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Vendor credit");
  return [dr({ key: "ACCOUNTS_PAYABLE" }, amountCents, { propertyId: dims.propertyId ?? null }), cr(expense, amountCents, dims)];
}

/** Bank deposit: Dr bank, Cr Undeposited Funds — one pair per property so cash stays attributed. */
export function bankDepositLines(items: { amountCents: number; propertyId: string | null }[], bank: AccountRef): Line[] {
  const groups = byProperty(items.map((i) => ({ amountCents: i.amountCents, dims: { propertyId: i.propertyId } })));
  if (!groups.length) throw new RangeError("Choose at least one payment to deposit");
  groups.forEach((g) => positive(g.amountCents, "Deposit"));
  return groups.flatMap((g) => [dr(bank, g.amountCents, { propertyId: g.propertyId }), cr({ key: "UNDEPOSITED_FUNDS" }, g.amountCents, { propertyId: g.propertyId })]);
}

/** Transfer between bank accounts: Dr destination, Cr source. */
export function transferLines(amountCents: number, from: AccountRef, to: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Transfer");
  return [dr(to, amountCents, dims), cr(from, amountCents, dims)];
}

/** Categorize an imported bank line: money in → Dr bank, Cr category; money out → Dr category, Cr bank. */
export function bankCategorizeLines(signedCents: number, bank: AccountRef, category: AccountRef, dims: Dims): Line[] {
  if (!Number.isSafeInteger(signedCents) || signedCents === 0) throw new RangeError("Amount must be non-zero cents");
  const a = Math.abs(signedCents);
  return signedCents > 0 ? [dr(bank, a, dims), cr(category, a, dims)] : [dr(category, a, dims), cr(bank, a, dims)];
}

/** Owner distribution: Dr Owner Distributions, Cr Bank. */
export function distributionLines(amountCents: number, bank: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Distribution");
  return [dr({ key: "OWNER_DISTRIBUTIONS" }, amountCents, dims), cr(bank, amountCents, dims)];
}

/** Owner contribution: Dr Bank, Cr Owner Contributions. */
export function contributionLines(amountCents: number, bank: AccountRef, dims: Dims): Line[] {
  positive(amountCents, "Contribution");
  return [dr(bank, amountCents, dims), cr({ key: "OWNER_CONTRIBUTIONS" }, amountCents, dims)];
}

/** Reversal (void): swap every line's debit and credit. */
export function reverseLines(lines: Line[]): Line[] {
  return lines.map((l) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents }));
}
