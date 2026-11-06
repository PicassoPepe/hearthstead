import type { ScopedTx } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { AccountResolver, postEntry, reverseEntry } from "@/server/ledger/journal";
import { allocate, type ApplicationOrder, type OpenCharge } from "@/server/ledger/math";
import * as P from "@/server/ledger/postings";

/**
 * Lease money operations. Each function runs inside the caller's transaction (ScopedTx) and:
 *   1. posts a balanced journal entry (the source of truth for balances),
 *   2. writes the LeaseTransaction row users see,
 *   3. keeps PaymentApplication rows in sync (which charges each payment/credit paid off).
 * Balances are never stored — see leaseBalance().
 */
export type Actor = { orgId: string; userId: string | null };

type LeaseCtx = { leaseId: string; propertyId: string; unitId: string | null; depositAccountId: string | null };

export async function leaseContext(tx: ScopedTx, leaseId: string): Promise<LeaseCtx> {
  const lease = await tx.lease.findFirst({
    where: { id: leaseId },
    include: { units: { take: 1, orderBy: { createdAt: "asc" } }, property: { select: { defaultDepositAccountId: true } } },
  });
  if (!lease) throw new UserFacingError("Lease not found");
  return { leaseId, propertyId: lease.propertyId, unitId: lease.units[0]?.unitId ?? null, depositAccountId: lease.property.defaultDepositAccountId };
}

const dimsOf = (c: LeaseCtx): P.Dims => ({ propertyId: c.propertyId, unitId: c.unitId, leaseId: c.leaseId });

function positive(cents: number, what: string) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new UserFacingError(`${what} must be more than $0.00`, { amountCents: "Enter an amount" });
}

/** Charges with money still owed. */
export async function openCharges(tx: ScopedTx, leaseId: string): Promise<OpenCharge[]> {
  const charges = await tx.leaseTransaction.findMany({
    where: { leaseId, type: "CHARGE", voidedAt: null },
    include: { appliedTo: { select: { amountCents: true } } },
  });
  return charges
    .map((c) => ({
      id: c.id,
      remainingCents: c.amountCents - c.appliedTo.reduce((s, a) => s + a.amountCents, 0),
      dueDate: c.dueDate ?? c.date,
      date: c.date,
      chargeKind: c.chargeKind,
      createdAt: c.createdAt,
    }))
    .filter((c) => c.remainingCents > 0);
}

/** Payments/credits with money not yet applied to a charge (that money sits in Prepaid Rent). */
export async function unappliedSources(tx: ScopedTx, leaseId: string) {
  const sources = await tx.leaseTransaction.findMany({
    where: { leaseId, type: { in: ["PAYMENT", "CREDIT"] }, voidedAt: null },
    include: { appliedFrom: { select: { amountCents: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const returned = new Set(
    (await tx.leaseTransaction.findMany({ where: { leaseId, type: "RETURNED_PAYMENT", voidedAt: null }, select: { relatedId: true } })).map((r) => r.relatedId),
  );
  return sources
    .filter((s) => !returned.has(s.id))
    .map((s) => ({ id: s.id, unappliedCents: s.amountCents - s.appliedFrom.reduce((t, a) => t + a.amountCents, 0) }))
    .filter((s) => s.unappliedCents > 0);
}

/** Use any prepaid balance (unapplied payments/credits, oldest first) to pay open charges. */
export async function applyPrepaid(tx: ScopedTx, a: Actor, leaseId: string, date: Date, order: ApplicationOrder = "OLDEST_FIRST"): Promise<number> {
  const sources = await unappliedSources(tx, leaseId);
  if (!sources.length) return 0;
  let charges = await openCharges(tx, leaseId);
  if (!charges.length) return 0;
  const rows: { sourceId: string; chargeId: string; amountCents: number }[] = [];
  for (const s of sources) {
    const r = allocate(s.unappliedCents, charges, order);
    for (const app of r.applications) rows.push({ sourceId: s.id, ...app });
    const used = new Map(r.applications.map((x) => [x.chargeId, x.amountCents]));
    charges = charges.map((c) => ({ ...c, remainingCents: c.remainingCents - (used.get(c.id) ?? 0) })).filter((c) => c.remainingCents > 0);
    if (!charges.length) break;
  }
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  if (total === 0) return 0;
  const ctx = await leaseContext(tx, leaseId);
  await postEntry(tx, a.orgId, a.userId, { date, memo: "Prepaid balance applied", source: "PREPAID_APPLIED", sourceId: leaseId, lines: P.prepaidApplicationLines(total, dimsOf(ctx)) });
  await tx.paymentApplication.createMany({ data: rows.map((r) => ({ organizationId: a.orgId, ...r })) });
  return total;
}

// ─── Charges ──────────────────────────────────────────────────────────────

export async function postCharge(
  tx: ScopedTx,
  a: Actor,
  input: { leaseId: string; accountId: string; amountCents: number; date: Date; dueDate?: Date | null; memo?: string | null; chargeKind?: string; order?: ApplicationOrder; skipPrepaid?: boolean },
) {
  positive(input.amountCents, "Charge");
  const ctx = await leaseContext(tx, input.leaseId);
  const account = await tx.account.findFirst({ where: { id: input.accountId } });
  if (!account) throw new UserFacingError("Choose a valid account", { accountId: "Choose an account" });
  const opening = input.chargeKind === "OPENING_BALANCE" && account.systemKey === "OPENING_BALANCE_EQUITY";
  if (!opening && !["INCOME", "LIABILITY"].includes(account.type)) throw new UserFacingError("Charges post to an income account (or Security Deposits Held)", { accountId: "Choose an income account" });
  const je = await postEntry(tx, a.orgId, a.userId, {
    date: input.date,
    memo: input.memo ?? account.name,
    source: "LEASE_CHARGE",
    sourceId: input.leaseId,
    lines: P.chargeLines(input.amountCents, { id: account.id }, dimsOf(ctx)),
  });
  const t = await tx.leaseTransaction.create({
    data: {
      organizationId: a.orgId,
      leaseId: input.leaseId,
      type: "CHARGE",
      amountCents: input.amountCents,
      date: input.date,
      dueDate: input.dueDate ?? input.date,
      memo: input.memo ?? account.name,
      accountId: account.id,
      chargeKind: input.chargeKind ?? (account.systemKey === "RENT_INCOME" ? "RENT" : "OTHER"),
      journalEntryId: je.id,
      createdById: a.userId,
    },
  });
  if (!input.skipPrepaid) await applyPrepaid(tx, a, input.leaseId, input.date, input.order);
  return t;
}

// ─── Payments & credits ───────────────────────────────────────────────────

export async function receivePayment(
  tx: ScopedTx,
  a: Actor,
  input: { leaseId: string; amountCents: number; date: Date; method?: string; reference?: string | null; memo?: string | null; depositAccountId?: string | null; paymentIntentId?: string | null; order?: ApplicationOrder },
) {
  positive(input.amountCents, "Payment");
  const ctx = await leaseContext(tx, input.leaseId);
  let depositTo: P.AccountRef = { key: "UNDEPOSITED_FUNDS" };
  if (input.depositAccountId) {
    const bank = await tx.account.findFirst({ where: { id: input.depositAccountId, isBank: true } });
    if (!bank) throw new UserFacingError("Choose a bank account", { depositAccountId: "Choose a bank account" });
    depositTo = { id: bank.id };
  }
  const r = allocate(input.amountCents, await openCharges(tx, input.leaseId), input.order);
  const je = await postEntry(tx, a.orgId, a.userId, {
    date: input.date,
    memo: input.memo ?? "Payment",
    source: "LEASE_PAYMENT",
    sourceId: input.leaseId,
    lines: P.paymentLines(input.amountCents, r.appliedCents, depositTo, dimsOf(ctx)),
  });
  const t = await tx.leaseTransaction.create({
    data: {
      organizationId: a.orgId,
      leaseId: input.leaseId,
      type: "PAYMENT",
      amountCents: input.amountCents,
      date: input.date,
      memo: input.memo ?? "Payment",
      method: input.method ?? "OTHER",
      reference: input.reference ?? null,
      journalEntryId: je.id,
      paymentIntentId: input.paymentIntentId ?? null,
      createdById: a.userId,
    },
  });
  if (r.applications.length) {
    await tx.paymentApplication.createMany({ data: r.applications.map((x) => ({ organizationId: a.orgId, sourceId: t.id, ...x })) });
  }
  return { transaction: t, appliedCents: r.appliedCents, prepaidCents: r.remainderCents };
}

export async function postCredit(
  tx: ScopedTx,
  a: Actor,
  input: { leaseId: string; amountCents: number; date: Date; accountId: string; memo?: string | null; order?: ApplicationOrder },
) {
  positive(input.amountCents, "Credit");
  const ctx = await leaseContext(tx, input.leaseId);
  const account = await tx.account.findFirst({ where: { id: input.accountId } });
  if (!account || !(["INCOME", "EXPENSE"].includes(account.type) || account.systemKey === "OPENING_BALANCE_EQUITY")) throw new UserFacingError("Credits post against an income or expense account", { accountId: "Choose an account" });
  const r = allocate(input.amountCents, await openCharges(tx, input.leaseId), input.order);
  const je = await postEntry(tx, a.orgId, a.userId, {
    date: input.date,
    memo: input.memo ?? `Credit — ${account.name}`,
    source: "LEASE_CREDIT",
    sourceId: input.leaseId,
    lines: P.creditLines(input.amountCents, r.appliedCents, { id: account.id }, dimsOf(ctx)),
  });
  const t = await tx.leaseTransaction.create({
    data: { organizationId: a.orgId, leaseId: input.leaseId, type: "CREDIT", amountCents: input.amountCents, date: input.date, memo: input.memo ?? `Credit — ${account.name}`, accountId: account.id, journalEntryId: je.id, createdById: a.userId },
  });
  if (r.applications.length) await tx.paymentApplication.createMany({ data: r.applications.map((x) => ({ organizationId: a.orgId, sourceId: t.id, ...x })) });
  return t;
}

// ─── Security deposits & refunds ──────────────────────────────────────────

async function depositCash(tx: ScopedTx, ctx: LeaseCtx, accounts: AccountResolver): Promise<string> {
  return ctx.depositAccountId ?? (await accounts.id("DEPOSIT_CASH"));
}

export async function depositHeld(tx: ScopedTx, leaseId: string): Promise<number> {
  const accounts = new AccountResolver(tx);
  const held = await tx.journalLine.aggregate({ where: { leaseId, accountId: await accounts.id("DEPOSITS_HELD") }, _sum: { creditCents: true, debitCents: true } });
  return (held._sum.creditCents ?? 0) - (held._sum.debitCents ?? 0);
}

export async function recordDeposit(tx: ScopedTx, a: Actor, input: { leaseId: string; amountCents: number; date: Date; method?: string; reference?: string | null }) {
  positive(input.amountCents, "Deposit");
  const ctx = await leaseContext(tx, input.leaseId);
  const accounts = new AccountResolver(tx);
  const je = await postEntry(tx, a.orgId, a.userId, {
    date: input.date, memo: "Security deposit received", source: "LEASE_DEPOSIT", sourceId: input.leaseId,
    lines: P.depositLines(input.amountCents, { id: await depositCash(tx, ctx, accounts) }, dimsOf(ctx)),
  }, accounts);
  return tx.leaseTransaction.create({
    data: { organizationId: a.orgId, leaseId: input.leaseId, type: "DEPOSIT", amountCents: input.amountCents, date: input.date, memo: "Security deposit received", method: input.method ?? "OTHER", reference: input.reference ?? null, journalEntryId: je.id, createdById: a.userId },
  });
}

export async function refund(tx: ScopedTx, a: Actor, input: { leaseId: string; kind: "DEPOSIT" | "PREPAID"; amountCents: number; date: Date; bankAccountId?: string | null; memo?: string | null }) {
  positive(input.amountCents, "Refund");
  const ctx = await leaseContext(tx, input.leaseId);
  const accounts = new AccountResolver(tx);
  if (input.kind === "DEPOSIT") {
    const held = await depositHeld(tx, input.leaseId);
    if (input.amountCents > held) throw new UserFacingError(`Only ${(held / 100).toFixed(2)} of deposit is held for this lease`, { amountCents: "More than the deposit held" });
    const je = await postEntry(tx, a.orgId, a.userId, {
      date: input.date, memo: input.memo ?? "Security deposit refund", source: "LEASE_REFUND", sourceId: input.leaseId,
      lines: P.depositRefundLines(input.amountCents, { id: await depositCash(tx, ctx, accounts) }, dimsOf(ctx)),
    }, accounts);
    return tx.leaseTransaction.create({
      data: { organizationId: a.orgId, leaseId: input.leaseId, type: "REFUND", chargeKind: "DEPOSIT_REFUND", amountCents: input.amountCents, date: input.date, memo: input.memo ?? "Security deposit refund", journalEntryId: je.id, createdById: a.userId },
    });
  }
  // Prepaid refund consumes unapplied payment money, oldest first.
  const sources = await unappliedSources(tx, input.leaseId);
  const available = sources.reduce((s, x) => s + x.unappliedCents, 0);
  if (input.amountCents > available) throw new UserFacingError(`Only ${(available / 100).toFixed(2)} is available to refund`, { amountCents: "More than the credit balance" });
  const bank = input.bankAccountId ?? (await accounts.id("OPERATING_CASH"));
  const je = await postEntry(tx, a.orgId, a.userId, {
    date: input.date, memo: input.memo ?? "Refund of credit balance", source: "LEASE_REFUND", sourceId: input.leaseId,
    lines: P.prepaidRefundLines(input.amountCents, { id: bank }, dimsOf(ctx)),
  }, accounts);
  const t = await tx.leaseTransaction.create({
    data: { organizationId: a.orgId, leaseId: input.leaseId, type: "REFUND", chargeKind: "PREPAID_REFUND", amountCents: input.amountCents, date: input.date, memo: input.memo ?? "Refund of credit balance", journalEntryId: je.id, createdById: a.userId },
  });
  let left = input.amountCents;
  for (const s of sources) {
    if (left === 0) break;
    const take = Math.min(left, s.unappliedCents);
    await tx.paymentApplication.create({ data: { organizationId: a.orgId, sourceId: s.id, chargeId: t.id, amountCents: take } });
    left -= take;
  }
  return t;
}

// ─── Returned payments & voids ────────────────────────────────────────────

async function unpostSource(tx: ScopedTx, a: Actor, sourceTxId: string, date: Date, memo: string, source: string) {
  const s = await tx.leaseTransaction.findFirst({ where: { id: sourceTxId }, include: { appliedFrom: { include: { charge: { select: { type: true } } } }, journalEntry: { include: { lines: true } } } });
  if (!s) throw new UserFacingError("Transaction not found");
  if (s.appliedFrom.some((x) => x.charge.type === "REFUND")) throw new UserFacingError("Part of this payment was refunded. Void the refund first.");
  const applied = s.appliedFrom.reduce((t, x) => t + x.amountCents, 0);
  const debitLine = s.journalEntry.lines.find((l) => l.debitCents > 0);
  if (!debitLine) throw new Error("Malformed source entry");
  const ctx = await leaseContext(tx, s.leaseId);
  const je = await postEntry(tx, a.orgId, a.userId, {
    date, memo, source, sourceId: s.id,
    lines: P.returnedPaymentLines(s.amountCents, applied, { id: debitLine.accountId }, dimsOf(ctx)),
  });
  await tx.paymentApplication.deleteMany({ where: { sourceId: s.id } });
  return { source: s, entry: je };
}

export async function returnPayment(tx: ScopedTx, a: Actor, input: { paymentId: string; date: Date; nsfFeeCents?: number; reason?: string; order?: ApplicationOrder }) {
  const p = await tx.leaseTransaction.findFirst({ where: { id: input.paymentId } });
  if (!p || p.type !== "PAYMENT") throw new UserFacingError("Only payments can be returned");
  if (p.voidedAt) throw new UserFacingError("This payment was voided");
  if (await tx.leaseTransaction.findFirst({ where: { relatedId: p.id, type: "RETURNED_PAYMENT", voidedAt: null } })) throw new UserFacingError("This payment was already returned");
  const { entry } = await unpostSource(tx, a, p.id, input.date, `Returned payment${input.reason ? ` — ${input.reason}` : ""}`, "LEASE_RETURNED_PAYMENT");
  const ret = await tx.leaseTransaction.create({
    data: {
      organizationId: a.orgId, leaseId: p.leaseId, type: "RETURNED_PAYMENT", amountCents: p.amountCents, date: input.date,
      memo: `Returned payment${input.reason ? ` — ${input.reason}` : ""}${p.reference ? ` (ref ${p.reference})` : ""}`,
      relatedId: p.id, journalEntryId: entry.id, createdById: a.userId,
    },
  });
  if (input.nsfFeeCents && input.nsfFeeCents > 0) {
    const nsf = await new AccountResolver(tx).id("NSF_FEE_INCOME");
    await postCharge(tx, a, { leaseId: p.leaseId, accountId: nsf, amountCents: input.nsfFeeCents, date: input.date, memo: "NSF fee", chargeKind: "NSF_FEE", order: input.order, skipPrepaid: true });
  }
  await applyPrepaid(tx, a, p.leaseId, input.date, input.order);
  return ret;
}

export async function voidTransaction(tx: ScopedTx, a: Actor, input: { id: string; date: Date; reason: string; order?: ApplicationOrder }) {
  const t = await tx.leaseTransaction.findFirst({ where: { id: input.id }, include: { appliedTo: true } });
  if (!t) throw new UserFacingError("Transaction not found");
  if (t.voidedAt) throw new UserFacingError("Already voided");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new UserFacingError("Give a reason for the void", { reason: "Required" });
  const memo = `Void: ${t.memo ?? t.type.toLowerCase()} — ${reason}`;

  switch (t.type) {
    case "RETURNED_PAYMENT":
      throw new UserFacingError("A returned payment can't be voided. Record a new payment instead.");
    case "CHARGE": {
      await reverseEntry(tx, a.orgId, a.userId, t.journalEntryId, input.date, memo);
      const applied = t.appliedTo.reduce((s, x) => s + x.amountCents, 0);
      if (applied > 0) {
        const ctx = await leaseContext(tx, t.leaseId);
        await postEntry(tx, a.orgId, a.userId, { date: input.date, memo: "Payments moved to credit balance after void", source: "PREPAID_UNAPPLIED", sourceId: t.id, lines: P.unapplyLines(applied, dimsOf(ctx)) });
        await tx.paymentApplication.deleteMany({ where: { chargeId: t.id } });
      }
      break;
    }
    case "PAYMENT":
    case "CREDIT":
      if (t.type === "PAYMENT" && (await tx.leaseTransaction.findFirst({ where: { relatedId: t.id, type: "RETURNED_PAYMENT", voidedAt: null } }))) {
        throw new UserFacingError("This payment was returned; it can't also be voided.");
      }
      await unpostSource(tx, a, t.id, input.date, memo, "LEASE_VOID");
      break;
    case "REFUND":
      await reverseEntry(tx, a.orgId, a.userId, t.journalEntryId, input.date, memo);
      await tx.paymentApplication.deleteMany({ where: { chargeId: t.id } });
      break;
    case "DEPOSIT": {
      const held = await depositHeld(tx, t.leaseId);
      if (held < t.amountCents) throw new UserFacingError("Part of this deposit was already refunded. Void the refund first.");
      await reverseEntry(tx, a.orgId, a.userId, t.journalEntryId, input.date, memo);
      break;
    }
  }
  await tx.leaseTransaction.update({ where: { id: t.id }, data: { voidedAt: new Date(), voidReason: reason } });
  await applyPrepaid(tx, a, t.leaseId, input.date, input.order);
  return t;
}

// ─── Balances (computed from the ledger, never stored) ────────────────────

/** Lease balance = A/R for the lease − prepaid (credit balance). Positive = tenant owes. */
export async function leaseBalance(tx: ScopedTx, leaseId: string) {
  const accounts = new AccountResolver(tx);
  const [ar, prepaid] = await Promise.all([accounts.id("ACCOUNTS_RECEIVABLE"), accounts.id("PREPAID_RENT")]);
  const rows = await tx.journalLine.groupBy({ by: ["accountId"], where: { leaseId, accountId: { in: [ar, prepaid] } }, _sum: { debitCents: true, creditCents: true } });
  const net = (id: string) => {
    const r = rows.find((x) => x.accountId === id);
    return (r?._sum.debitCents ?? 0) - (r?._sum.creditCents ?? 0);
  };
  const receivableCents = net(ar);
  const prepaidCents = 0 - net(prepaid) || 0; // avoid -0
  return { receivableCents, prepaidCents, balanceCents: receivableCents - prepaidCents };
}
