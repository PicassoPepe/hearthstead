/**
 * BankFeedProvider adapter: pulls posted bank transactions for a linked bank account.
 *
 * - `mock` (default) simulates a bank that mirrors the books: every ledger movement on the
 *   account shows up 0–2 days later with a bank-style description, plus a monthly service fee
 *   and an interest credit — enough to exercise matching, categorizing and reconciliation.
 * - `plaid` calls Plaid's /transactions/sync with the access token stored on the bank account.
 *
 * Amounts are signed integer cents: + money in, − money out.
 */
export type FeedTransaction = { externalId: string; date: string; amountCents: number; description: string };
export type LedgerHint = { id: string; date: string; amountCents: number; memo: string };

export interface BankFeedProvider {
  readonly name: string;
  sync(input: { bankAccountId: string; externalRef: string | null; since: string; until: string; ledger: LedgerHint[] }): Promise<FeedTransaction[]>;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const addDaysISO = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export class MockBankFeedProvider implements BankFeedProvider {
  readonly name = "mock";
  async sync({ bankAccountId, since, until, ledger }: Parameters<BankFeedProvider["sync"]>[0]): Promise<FeedTransaction[]> {
    const out: FeedTransaction[] = [];
    for (const l of ledger) {
      const lag = hash(l.id) % 3;
      const date = addDaysISO(l.date, lag);
      if (date > until || date < since) continue;
      const desc = l.amountCents > 0 ? `DEPOSIT ${l.memo.toUpperCase().slice(0, 28)}` : `${hash(l.id) % 2 ? "CHECK" : "ACH DEBIT"} ${l.memo.toUpperCase().slice(0, 28)}`;
      out.push({ externalId: `mock-${l.id}`, date, amountCents: l.amountCents, description: desc });
    }
    // Monthly bank activity that isn't in the books yet.
    let d = new Date(`${since.slice(0, 7)}-01T00:00:00Z`);
    while (d.toISOString().slice(0, 10) <= until) {
      const month = d.toISOString().slice(0, 7);
      const fee = `${month}-28`;
      const interest = `${month}-27`;
      if (fee >= since && fee <= until) out.push({ externalId: `mock-fee-${bankAccountId}-${month}`, date: fee, amountCents: -1500, description: "MONTHLY SERVICE FEE" });
      if (interest >= since && interest <= until) out.push({ externalId: `mock-int-${bankAccountId}-${month}`, date: interest, amountCents: 100 + (hash(bankAccountId + month) % 400), description: "INTEREST PAYMENT" });
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
}

/** Plaid transactions/sync. Requires PLAID_CLIENT_ID, PLAID_SECRET; the access token lives in BankAccount.externalRef. */
export class PlaidBankFeedProvider implements BankFeedProvider {
  readonly name = "plaid";
  constructor(private readonly env = process.env.PLAID_ENV ?? "sandbox") {}
  async sync({ externalRef, since, until }: Parameters<BankFeedProvider["sync"]>[0]): Promise<FeedTransaction[]> {
    if (!externalRef) throw new Error("This bank account isn't linked to Plaid yet");
    const out: FeedTransaction[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`https://${this.env}.plaid.com/transactions/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, access_token: externalRef, cursor }),
      });
      if (!res.ok) throw new Error(`Plaid error ${res.status}`);
      const body = (await res.json()) as { added: { transaction_id: string; date: string; amount: number; name: string }[]; next_cursor: string; has_more: boolean };
      // Plaid amounts are positive for money out; convert to signed cents (+ in).
      for (const t of body.added) if (t.date >= since && t.date <= until) out.push({ externalId: t.transaction_id, date: t.date, amountCents: -Math.round(t.amount * 100), description: t.name });
      cursor = body.next_cursor;
      if (!body.has_more) break;
    }
    return out;
  }
}

let provider: BankFeedProvider | undefined;
export function getBankFeedProvider(): BankFeedProvider {
  provider ??= process.env.BANKFEED_PROVIDER === "plaid" ? new PlaidBankFeedProvider() : new MockBankFeedProvider();
  return provider;
}

/** Parse a bank CSV export (Date, Description, Amount — or Debit/Credit columns). */
export function parseBankCsv(rows: Record<string, string>[]): { ok: FeedTransaction[]; errors: { row: number; message: string }[] } {
  const ok: FeedTransaction[] = [];
  const errors: { row: number; message: string }[] = [];
  const pick = (r: Record<string, string>, ...names: string[]) => {
    for (const k of Object.keys(r)) if (names.includes(k.trim().toLowerCase())) return (r[k] ?? "").trim();
    return "";
  };
  const money = (s: string): number | null => {
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
    const n = s.replace(/[^0-9.]/g, "");
    if (!/^\d+(\.\d{0,2})?$/.test(n)) return null;
    const [w, f = ""] = n.split(".");
    const c = Number(w) * 100 + Number(f.padEnd(2, "0"));
    return neg ? -c : c;
  };
  rows.forEach((r, i) => {
    const rawDate = pick(r, "date", "posted date", "transaction date", "posting date");
    let date = "";
    const us = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) date = rawDate;
    else if (us) date = `${us[3]!.length === 2 ? `20${us[3]}` : us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
    const description = pick(r, "description", "memo", "name", "payee");
    let amount = money(pick(r, "amount"));
    if (amount === null) {
      const debit = money(pick(r, "debit", "withdrawal"));
      const credit = money(pick(r, "credit", "deposit"));
      if (debit !== null || credit !== null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date) return void errors.push({ row: i + 2, message: "Unrecognized date" });
    if (amount === null || amount === 0) return void errors.push({ row: i + 2, message: "Missing amount" });
    ok.push({ externalId: `csv-${date}-${amount}-${hash(description + i)}`, date, amountCents: amount, description: description || "(no description)" });
  });
  return { ok, errors };
}
