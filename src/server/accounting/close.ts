import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { postEntry, type EntryInput } from "@/server/ledger/journal";
import { utcDate } from "@/lib/dates";

/**
 * Year-end close. For the year, each income and expense account's net balance (per property, so
 * owner reporting stays right) is moved into Retained Earnings by a closing entry dated Dec 31,
 * and the books lock through that day. Income statements ignore closing entries; the balance
 * sheet still balances. Only the most recent closed year can be reopened.
 */
export async function closeStatus(db: ScopedDb) {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { booksClosedThrough: true } });
  const first = await db.journalEntry.findFirst({ orderBy: { date: "asc" }, select: { date: true } });
  return { closedThrough: org.booksClosedThrough, firstYear: first?.date.getUTCFullYear() ?? null };
}

async function yearNet(db: ScopedDb, year: number) {
  const accts = await db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } });
  const rows = await db.journalLine.groupBy({
    by: ["accountId", "propertyId"],
    where: { accountId: { in: accts.map((a) => a.id) }, journalEntry: { date: { gte: utcDate(year, 0, 1), lte: utcDate(year, 11, 31) } } },
    _sum: { debitCents: true, creditCents: true },
  });
  return rows.map((r) => ({ accountId: r.accountId, propertyId: r.propertyId, net: (r._sum.debitCents ?? 0) - (r._sum.creditCents ?? 0) })).filter((r) => r.net !== 0);
}

/** Preview: net income for the year (what moves to retained earnings). */
export async function previewClose(db: ScopedDb, year: number) {
  const rows = await yearNet(db, year);
  const netIncome = -rows.reduce((n, r) => n + r.net, 0);
  return { year, netIncomeCents: netIncome, lines: rows.length };
}

export async function closeYear(db: ScopedDb, year: number, today: Date) {
  const { closedThrough } = await closeStatus(db);
  const yearEnd = utcDate(year, 11, 31);
  if (yearEnd >= today) throw new UserFacingError(`${year} isn't over yet.`);
  if (closedThrough && closedThrough >= yearEnd) throw new UserFacingError(`${year} is already closed.`);
  if (closedThrough && closedThrough < utcDate(year - 1, 11, 31)) throw new UserFacingError(`Close ${closedThrough.getUTCFullYear() + 1} first.`);
  const rows = await yearNet(db, year);
  const netIncome = -rows.reduce((n, r) => n + r.net, 0);
  await db.tx(async (tx) => {
    if (rows.length) {
      const re = await tx.account.findFirstOrThrow({ where: { systemKey: "RETAINED_EARNINGS" } });
      const lines: EntryInput["lines"] = [];
      const byProp = new Map<string | null, number>();
      for (const r of rows) {
        // Zero the account: credit a debit balance, debit a credit balance.
        lines.push({ account: { id: r.accountId }, debitCents: r.net < 0 ? -r.net : 0, creditCents: r.net > 0 ? r.net : 0, propertyId: r.propertyId, memo: `Close ${year}` });
        byProp.set(r.propertyId, (byProp.get(r.propertyId) ?? 0) + r.net);
      }
      for (const [propertyId, net] of byProp) if (net) lines.push({ account: { id: re.id }, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0, propertyId, memo: `Net income ${year} to retained earnings` });
      await postEntry(tx, db.ctx.orgId, db.ctx.userId, { date: yearEnd, memo: `Year-end close ${year}`, source: "YEAR_END_CLOSE", sourceId: String(year), lines });
    }
    await tx.organization.update({ where: { id: db.ctx.orgId }, data: { booksClosedThrough: yearEnd } });
  }, { timeout: 60_000 });
  await audit(db, { action: "books.year_closed", entityType: "Organization", entityId: db.ctx.orgId, after: { year, netIncomeCents: netIncome } });
  return { year, netIncomeCents: netIncome };
}

export async function reopenYear(db: ScopedDb, year: number) {
  const { closedThrough } = await closeStatus(db);
  if (!closedThrough || closedThrough.getUTCFullYear() !== year) throw new UserFacingError("Only the most recently closed year can be reopened.");
  await db.tx(async (tx) => {
    const entry = await tx.journalEntry.findFirst({ where: { source: "YEAR_END_CLOSE", sourceId: String(year), reversesId: null, reversedBy: null }, include: { lines: true } });
    if (entry) {
      await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
        date: entry.date, memo: `Reopen ${year}`, source: "YEAR_END_CLOSE", sourceId: `${year}:reopen`, reversesId: entry.id,
        lines: entry.lines.map((l) => ({ account: { id: l.accountId }, debitCents: l.creditCents, creditCents: l.debitCents, propertyId: l.propertyId, memo: `Reopen ${year}` })),
      });
    }
    await tx.organization.update({ where: { id: db.ctx.orgId }, data: { booksClosedThrough: year > 0 ? utcDate(year - 1, 11, 31) : null } });
  }, { timeout: 60_000 });
  // If the prior year was never closed, don't pretend it is.
  const prior = await db.journalEntry.findFirst({ where: { source: "YEAR_END_CLOSE", sourceId: String(year - 1), reversedBy: null } });
  if (!prior) await adminDb.organization.update({ where: { id: db.ctx.orgId }, data: { booksClosedThrough: null } });
  await audit(db, { action: "books.year_reopened", entityType: "Organization", entityId: db.ctx.orgId, after: { year } });
}

/** Years that can be closed or reopened, newest first. */
export async function closableYears(db: ScopedDb, today: Date) {
  const { closedThrough, firstYear } = await closeStatus(db);
  if (!firstYear) return [];
  const out: { year: number; closed: boolean }[] = [];
  for (let y = today.getUTCFullYear() - 1; y >= firstYear; y--) out.push({ year: y, closed: Boolean(closedThrough && closedThrough >= utcDate(y, 11, 31)) });
  return out;
}
