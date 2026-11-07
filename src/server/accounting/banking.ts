import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { postEntry } from "@/server/ledger/journal";
import { bankCategorizeLines, bankDepositLines, transferLines } from "@/server/ledger/postings";
import { getBankFeedProvider, type FeedTransaction } from "@/adapters/bank-feed";
import { addDays, diffDays, parseISODate, toISODate } from "@/lib/dates";

async function bank(db: ScopedDb, accountId: string) {
  const a = await db.account.findFirst({ where: { id: accountId, isBank: true }, include: { bankAccount: true } });
  if (!a) throw new UserFacingError("Choose a bank account", { bankAccountId: "Choose a bank account" });
  return a;
}

/** Ledger balance of a bank account (debits − credits). */
export async function bankBalance(db: ScopedDb, accountId: string, asOf?: Date): Promise<number> {
  const s = await db.journalLine.aggregate({ where: { accountId, ...(asOf ? { journalEntry: { date: { lte: asOf } } } : {}) }, _sum: { debitCents: true, creditCents: true } });
  return (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0);
}

// ---------------------------------------------------------------- deposits

/** Payments sitting in Undeposited Funds that haven't been banked yet. */
export async function undepositedPayments(db: ScopedDb) {
  const und = await db.account.findFirstOrThrow({ where: { systemKey: "UNDEPOSITED_FUNDS" } });
  const txs = await db.leaseTransaction.findMany({
    where: { type: "PAYMENT", voidedAt: null, depositId: null, journalEntry: { lines: { some: { accountId: und.id, debitCents: { gt: 0 } } } } },
    orderBy: { date: "asc" },
    include: { lease: { select: { id: true, propertyId: true, property: { select: { name: true } }, tenants: { where: { role: "PRIMARY" }, select: { tenant: { select: { firstName: true, lastName: true, companyName: true } } } } } } },
  });
  const returned = new Set((await db.leaseTransaction.findMany({ where: { type: "RETURNED_PAYMENT", voidedAt: null, relatedId: { in: txs.map((t) => t.id) } }, select: { relatedId: true } })).map((r) => r.relatedId));
  return txs
    .filter((t) => !returned.has(t.id))
    .map((t) => {
      const ten = t.lease.tenants[0]?.tenant;
      return { id: t.id, date: toISODate(t.date), amountCents: t.amountCents, method: t.method ?? "OTHER", reference: t.reference, propertyId: t.lease.propertyId, property: t.lease.property.name, payer: ten ? ten.companyName ?? `${ten.firstName} ${ten.lastName}` : "Tenant", leaseId: t.leaseId };
    });
}

export async function createDeposit(db: ScopedDb, input: { bankAccountId: string; date: string; paymentIds: string[]; memo?: string }) {
  await bank(db, input.bankAccountId);
  if (!input.paymentIds.length) throw new UserFacingError("Select the payments in this deposit");
  const open = await undepositedPayments(db);
  const items = input.paymentIds.map((id) => {
    const p = open.find((x) => x.id === id);
    if (!p) throw new UserFacingError("One of those payments was already deposited or voided — refresh and try again");
    return p;
  });
  const total = items.reduce((s, i) => s + i.amountCents, 0);
  const dep = await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: parseISODate(input.date),
      memo: input.memo || `Bank deposit — ${items.length} payment${items.length === 1 ? "" : "s"}`,
      source: "BANK_DEPOSIT",
      lines: bankDepositLines(items.map((i) => ({ amountCents: i.amountCents, propertyId: i.propertyId })), { id: input.bankAccountId }),
    });
    const d = await tx.deposit.create({
      data: { organizationId: db.ctx.orgId, bankAccountId: input.bankAccountId, date: parseISODate(input.date), totalCents: total, memo: input.memo || null, journalEntryId: je.id, createdById: db.ctx.userId, items: { create: items.map((i) => ({ organizationId: db.ctx.orgId, leaseTransactionId: i.id, amountCents: i.amountCents })) } },
    });
    await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: d.id } });
    await tx.leaseTransaction.updateMany({ where: { id: { in: input.paymentIds } }, data: { depositId: d.id } });
    return d;
  });
  await audit(db, { action: "deposit.created", entityType: "Deposit", entityId: dep.id, after: { total, count: items.length } });
  return dep;
}

// ---------------------------------------------------------------- transfers

export async function createTransfer(db: ScopedDb, input: { fromAccountId: string; toAccountId: string; amountCents: number; date: string; propertyId?: string | null; memo?: string }) {
  if (input.fromAccountId === input.toAccountId) throw new UserFacingError("Choose two different accounts", { toAccountId: "Same as the source" });
  const [from, to] = [await bank(db, input.fromAccountId), await bank(db, input.toAccountId)];
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Enter an amount" });
  if (input.propertyId && !(await db.property.findFirst({ where: { id: input.propertyId } }))) throw new UserFacingError("Choose a valid property");
  const je = await db.tx((tx) =>
    postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: parseISODate(input.date),
      memo: input.memo || `Transfer ${from.name} → ${to.name}`,
      source: "TRANSFER",
      lines: transferLines(input.amountCents, { id: from.id }, { id: to.id }, { propertyId: input.propertyId ?? null }),
    }),
  );
  await audit(db, { action: "transfer.created", entityType: "JournalEntry", entityId: je.id, after: input });
  return je;
}

// ---------------------------------------------------------------- bank feed

async function insertFeed(db: ScopedDb, bankAccountId: string, rows: FeedTransaction[]) {
  if (!rows.length) return 0;
  const r = await db.bankTransaction.createMany({
    data: rows.map((t) => ({ organizationId: db.ctx.orgId, bankAccountId, date: parseISODate(t.date), amountCents: t.amountCents, description: t.description, externalId: t.externalId })),
    skipDuplicates: true,
  });
  await autoMatch(db, bankAccountId);
  return r.count;
}

/** Pull new transactions from the bank feed provider (mock by default) and auto-match exact hits. */
export async function syncBankFeed(db: ScopedDb, bankAccountId: string, today: Date = new Date()) {
  const a = await bank(db, bankAccountId);
  const since = addDays(today, -60);
  const items = await registerItems(db, a.id, { journalEntry: { date: { gte: since } } });
  const feed = await getBankFeedProvider().sync({
    bankAccountId: a.id, externalRef: a.bankAccount?.externalRef ?? null, since: toISODate(since), until: toISODate(today),
    ledger: items.filter((i) => i.amountCents !== 0).map((i) => ({ id: i.id, date: toISODate(i.date), amountCents: i.amountCents, memo: i.memo })),
  });
  const added = await insertFeed(db, a.id, feed);
  await audit(db, { action: "bank_feed.synced", entityType: "Account", entityId: a.id, after: { fetched: feed.length, added } });
  return { fetched: feed.length, added };
}

export async function importBankCsv(db: ScopedDb, bankAccountId: string, rows: FeedTransaction[]) {
  await bank(db, bankAccountId);
  const added = await insertFeed(db, bankAccountId, rows);
  await audit(db, { action: "bank_feed.csv_imported", entityType: "Account", entityId: bankAccountId, after: { rows: rows.length, added } });
  return { added, skipped: rows.length - added };
}

/**
 * Register items: one per journal entry on this bank account (a bill payment split across six
 * properties is one bank movement). The item's id is its first line's id; `lineIds` are all of them.
 */
export async function registerItems(db: ScopedDb, bankAccountId: string, where: Prisma.JournalLineWhereInput = {}) {
  const lines = await db.journalLine.findMany({ where: { accountId: bankAccountId, ...where }, include: { journalEntry: { select: { date: true, memo: true, source: true } } }, orderBy: [{ journalEntry: { date: "asc" } }, { createdAt: "asc" }, { id: "asc" }] });
  const byEntry = new Map<string, { id: string; lineIds: string[]; date: Date; amountCents: number; memo: string; reconciliationId: string | null }>();
  for (const l of lines) {
    const e = byEntry.get(l.journalEntryId);
    if (e) {
      e.lineIds.push(l.id);
      e.amountCents += l.debitCents - l.creditCents;
    } else {
      byEntry.set(l.journalEntryId, { id: l.id, lineIds: [l.id], date: l.journalEntry.date, amountCents: l.debitCents - l.creditCents, memo: l.journalEntry.memo ?? l.journalEntry.source, reconciliationId: l.reconciliationId });
    }
  }
  return [...byEntry.values()];
}

async function matchedLineIds(db: ScopedDb, bankAccountId: string) {
  return new Set((await db.bankTransaction.findMany({ where: { bankAccountId, matchedLineId: { not: null } }, select: { matchedLineId: true } })).map((t) => t.matchedLineId!));
}

/** Register items on this bank account not yet matched to an imported bank transaction. */
async function unmatchedLines(db: ScopedDb, bankAccountId: string) {
  const taken = await matchedLineIds(db, bankAccountId);
  return (await registerItems(db, bankAccountId)).filter((i) => i.amountCents !== 0 && !i.lineIds.some((id) => taken.has(id)));
}

export type MatchSuggestion = { lineId: string; date: string; amountCents: number; memo: string; daysApart: number };

/** Suggestions: same signed amount within ±5 days, closest date first. */
export async function matchSuggestions(db: ScopedDb, bankAccountId: string) {
  const [feed, lines] = await Promise.all([db.bankTransaction.findMany({ where: { bankAccountId, status: "UNMATCHED" } }), unmatchedLines(db, bankAccountId)]);
  const out = new Map<string, MatchSuggestion[]>();
  for (const t of feed) {
    const c = lines
      .filter((l) => l.amountCents === t.amountCents && Math.abs(diffDays(l.date, t.date)) <= 5)
      .map((l) => ({ lineId: l.id, date: toISODate(l.date), amountCents: l.amountCents, memo: l.memo, daysApart: Math.abs(diffDays(l.date, t.date)) }))
      .sort((a, b) => a.daysApart - b.daysApart);
    if (c.length) out.set(t.id, c.slice(0, 3));
  }
  return out;
}

/** Auto-match when there is exactly one candidate and no other feed line competes for it. */
async function autoMatch(db: ScopedDb, bankAccountId: string) {
  const sugg = await matchSuggestions(db, bankAccountId);
  const claims = new Map<string, number>();
  for (const s of sugg.values()) if (s.length === 1) claims.set(s[0]!.lineId, (claims.get(s[0]!.lineId) ?? 0) + 1);
  for (const [txId, s] of sugg) {
    if (s.length === 1 && claims.get(s[0]!.lineId) === 1) await db.bankTransaction.update({ where: { id: txId }, data: { status: "MATCHED", matchedLineId: s[0]!.lineId } });
  }
}

export async function matchBankTransaction(db: ScopedDb, txId: string, lineId: string) {
  const t = await db.bankTransaction.findFirst({ where: { id: txId } });
  if (!t) throw new UserFacingError("Bank transaction not found");
  if (t.status !== "UNMATCHED") throw new UserFacingError("This transaction is already handled");
  const item = (await unmatchedLines(db, t.bankAccountId)).find((i) => i.lineIds.includes(lineId));
  if (!item) throw new UserFacingError("Choose an unmatched transaction from this account's register");
  if (item.amountCents !== t.amountCents) throw new UserFacingError("Amounts don't match");
  lineId = item.id;
  await db.bankTransaction.update({ where: { id: txId }, data: { status: "MATCHED", matchedLineId: lineId } });
  await audit(db, { action: "bank_txn.matched", entityType: "BankTransaction", entityId: txId, after: { lineId } });
}

/** Book an unmatched bank line straight to a category (e.g. bank fees, interest). */
export async function categorizeBankTransaction(db: ScopedDb, txId: string, input: { accountId: string; propertyId?: string | null; memo?: string }) {
  const t = await db.bankTransaction.findFirst({ where: { id: txId } });
  if (!t) throw new UserFacingError("Bank transaction not found");
  if (t.status !== "UNMATCHED") throw new UserFacingError("This transaction is already handled");
  const cat = await db.account.findFirst({ where: { id: input.accountId } });
  if (!cat || cat.isBank || cat.id === t.bankAccountId) throw new UserFacingError("Choose a category account", { accountId: "Choose a category" });
  if (input.propertyId && !(await db.property.findFirst({ where: { id: input.propertyId } }))) throw new UserFacingError("Choose a valid property");
  await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: t.date,
      memo: input.memo || t.description,
      source: "BANK_FEED",
      sourceId: t.id,
      lines: bankCategorizeLines(t.amountCents, { id: t.bankAccountId }, { id: cat.id }, { propertyId: input.propertyId ?? null }),
    });
    const bankLine = await tx.journalLine.findFirstOrThrow({ where: { journalEntryId: je.id, accountId: t.bankAccountId } });
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "CATEGORIZED", journalEntryId: je.id, matchedLineId: bankLine.id } });
  });
  await audit(db, { action: "bank_txn.categorized", entityType: "BankTransaction", entityId: txId, after: input });
}

export async function setBankTransactionIgnored(db: ScopedDb, txId: string, ignored: boolean) {
  const t = await db.bankTransaction.findFirst({ where: { id: txId } });
  if (!t) throw new UserFacingError("Bank transaction not found");
  if (ignored && t.status !== "UNMATCHED") throw new UserFacingError("Only unmatched transactions can be excluded");
  if (!ignored && t.status === "CATEGORIZED") throw new UserFacingError("Void the categorized entry instead");
  await db.bankTransaction.update({ where: { id: txId }, data: ignored ? { status: "IGNORED" } : { status: "UNMATCHED", matchedLineId: null } });
}

// ---------------------------------------------------------------- reconciliation

/** Balance of everything cleared in completed reconciliations. */
async function clearedBalance(db: ScopedDb, bankAccountId: string) {
  const done = await db.reconciliation.findMany({ where: { bankAccountId, status: "COMPLETED" }, select: { id: true } });
  if (!done.length) return 0;
  const s = await db.journalLine.aggregate({ where: { accountId: bankAccountId, reconciliationId: { in: done.map((d) => d.id) } }, _sum: { debitCents: true, creditCents: true } });
  return (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0);
}

export async function startReconciliation(db: ScopedDb, input: { bankAccountId: string; statementDate: string; statementBalanceCents: number }) {
  await bank(db, input.bankAccountId);
  if (!Number.isSafeInteger(input.statementBalanceCents)) throw new UserFacingError("Enter the statement's ending balance", { statementBalanceCents: "Required" });
  const open = await db.reconciliation.findFirst({ where: { bankAccountId: input.bankAccountId, status: "IN_PROGRESS" } });
  if (open) {
    return db.reconciliation.update({ where: { id: open.id }, data: { statementDate: parseISODate(input.statementDate), statementBalanceCents: input.statementBalanceCents } });
  }
  const last = await db.reconciliation.findFirst({ where: { bankAccountId: input.bankAccountId, status: "COMPLETED" }, orderBy: { statementDate: "desc" } });
  if (last && parseISODate(input.statementDate) <= last.statementDate) throw new UserFacingError(`Choose a statement date after the last reconciliation (${toISODate(last.statementDate)})`, { statementDate: "After the last reconciliation" });
  return db.reconciliation.create({
    data: { organizationId: db.ctx.orgId, bankAccountId: input.bankAccountId, statementDate: parseISODate(input.statementDate), statementBalanceCents: input.statementBalanceCents, openingBalanceCents: await clearedBalance(db, input.bankAccountId), createdById: db.ctx.userId },
  });
}

/** Lines the user can tick: not cleared in a completed reconciliation, dated on/before the statement. */
export async function reconciliationWorkspace(db: ScopedDb, recId: string) {
  const rec = await db.reconciliation.findFirst({ where: { id: recId } });
  if (!rec) throw new UserFacingError("Reconciliation not found");
  const done = (await db.reconciliation.findMany({ where: { bankAccountId: rec.bankAccountId, status: "COMPLETED" }, select: { id: true } })).map((d) => d.id);
  const items = await registerItems(db, rec.bankAccountId, { journalEntry: { date: { lte: rec.statementDate } }, OR: [{ reconciliationId: null }, { reconciliationId: { notIn: done.length ? done : ["-"] } }] });
  const matched = new Set((await db.bankTransaction.findMany({ where: { bankAccountId: rec.bankAccountId, matchedLineId: { not: null }, date: { lte: rec.statementDate } }, select: { matchedLineId: true } })).map((t) => t.matchedLineId!));
  return {
    rec,
    lines: items.map((i) => ({ id: i.id, lineIds: i.lineIds, date: toISODate(i.date), memo: i.memo, amountCents: i.amountCents, cleared: i.reconciliationId === rec.id, inFeed: i.lineIds.some((id) => matched.has(id)) })),
  };
}

/** Finish: ticked items must bring opening + cleared to exactly the statement balance. */
export async function completeReconciliation(db: ScopedDb, recId: string, itemIds: string[]) {
  const { rec, lines } = await reconciliationWorkspace(db, recId);
  if (rec.status === "COMPLETED") throw new UserFacingError("Already completed");
  const picked = lines.filter((l) => itemIds.includes(l.id));
  if (picked.length !== new Set(itemIds).size) throw new UserFacingError("Some lines aren't part of this reconciliation — refresh and try again");
  const cleared = rec.openingBalanceCents + picked.reduce((s, l) => s + l.amountCents, 0);
  const diff = rec.statementBalanceCents - cleared;
  if (diff !== 0) throw new UserFacingError(`The difference must be $0.00 before you finish (it's ${(diff / 100).toFixed(2)}).`);
  const lineIds = picked.flatMap((p) => p.lineIds);
  await db.tx(async (tx) => {
    await tx.journalLine.updateMany({ where: { reconciliationId: rec.id }, data: { reconciliationId: null } });
    if (lineIds.length) await tx.journalLine.updateMany({ where: { id: { in: lineIds } }, data: { reconciliationId: rec.id } });
    await tx.reconciliation.update({ where: { id: rec.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  });
  await audit(db, { action: "reconciliation.completed", entityType: "Reconciliation", entityId: rec.id, after: { cleared: picked.length, statementBalanceCents: rec.statementBalanceCents } });
}

/** Undo the most recent completed reconciliation (lines become uncleared again). */
export async function undoReconciliation(db: ScopedDb, recId: string) {
  const rec = await db.reconciliation.findFirst({ where: { id: recId } });
  if (!rec || rec.status !== "COMPLETED") throw new UserFacingError("Only a completed reconciliation can be undone");
  const later = await db.reconciliation.findFirst({ where: { bankAccountId: rec.bankAccountId, status: "COMPLETED", statementDate: { gt: rec.statementDate } } });
  if (later) throw new UserFacingError("Undo the later reconciliations first");
  await db.tx(async (tx) => {
    // An in-progress reconciliation started from this one's balance would be stale.
    await tx.reconciliation.deleteMany({ where: { bankAccountId: rec.bankAccountId, status: "IN_PROGRESS" } });
    await tx.journalLine.updateMany({ where: { reconciliationId: rec.id }, data: { reconciliationId: null } });
    await tx.reconciliation.delete({ where: { id: rec.id } });
  });
  await audit(db, { action: "reconciliation.undone", entityType: "Reconciliation", entityId: rec.id });
}
