import type { ScopedTx } from "@/server/dal";
import { assertBalanced, type Line, type SystemKey } from "./postings";

/**
 * The only code path that writes journal entries. It resolves system account keys to ids,
 * verifies the entry balances, and writes the entry with its lines — inside the caller's
 * transaction, so a business action and its accounting commit (or fail) together.
 */
export type EntryInput = {
  date: Date;
  memo?: string | null;
  source: string;
  sourceId?: string | null;
  reversesId?: string | null;
  lines: Line[];
};

export class AccountResolver {
  private cache = new Map<SystemKey, string>();
  constructor(private readonly tx: ScopedTx) {}
  async id(key: SystemKey): Promise<string> {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const a = await this.tx.account.findFirst({ where: { systemKey: key }, select: { id: true } });
    if (!a) throw new Error(`System account ${key} is missing from the chart of accounts`);
    this.cache.set(key, a.id);
    return a.id;
  }
}

export async function postEntry(tx: ScopedTx, orgId: string, userId: string | null, input: EntryInput, accounts = new AccountResolver(tx)) {
  assertBalanced(input.lines);
  if (input.source !== "YEAR_END_CLOSE") {
    const org = await tx.organization.findFirst({ where: { id: orgId }, select: { booksClosedThrough: true } });
    if (org?.booksClosedThrough && input.date <= org.booksClosedThrough) {
      const { UserFacingError } = await import("@/server/action-result");
      throw new UserFacingError(`The books are closed through ${org.booksClosedThrough.toISOString().slice(0, 10)}. Use a later date, or reopen the year in Accounting → Year-end close.`);
    }
  }
  const resolved = await Promise.all(
    input.lines.map(async (l) => ({
      organizationId: orgId,
      accountId: "id" in l.account ? l.account.id : await accounts.id(l.account.key),
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      propertyId: l.propertyId ?? null,
      unitId: l.unitId ?? null,
      leaseId: l.leaseId ?? null,
      memo: l.memo ?? null,
    })),
  );
  const ids = new Set(resolved.map((l) => l.accountId));
  const found = await tx.account.count({ where: { id: { in: [...ids] } } });
  if (found !== ids.size) throw new Error("Journal line references an account outside this organization");

  return tx.journalEntry.create({
    data: {
      organizationId: orgId,
      date: input.date,
      memo: input.memo ?? null,
      source: input.source,
      sourceId: input.sourceId ?? null,
      reversesId: input.reversesId ?? null,
      createdById: userId,
      lines: { create: resolved.map(({ organizationId: _o, ...l }) => ({ ...l, organizationId: orgId })) },
    },
  });
}

/** Post the exact reverse of an existing entry (used by voids). */
export async function reverseEntry(tx: ScopedTx, orgId: string, userId: string | null, entryId: string, date: Date, memo: string) {
  const entry = await tx.journalEntry.findFirst({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
  if (!entry) throw new Error("Journal entry not found");
  if (entry.reversedBy) throw new Error("This entry has already been reversed");
  return postEntry(tx, orgId, userId, {
    date,
    memo,
    source: "REVERSAL",
    sourceId: entry.sourceId,
    reversesId: entry.id,
    lines: entry.lines.map((l) => ({
      account: { id: l.accountId },
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      propertyId: l.propertyId,
      unitId: l.unitId,
      leaseId: l.leaseId,
    })),
  });
}
