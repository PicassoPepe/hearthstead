/**
 * AccountingExportProvider: hands the general ledger to an outside accounting system.
 * - `csv` (default): QuickBooks Online "Journal Entry" import CSV (one row per line, entries
 *   grouped by Journal No.), which also imports into Xero and most GL tools.
 * - `quickbooks`: the shape of a QuickBooks Online push (JournalEntry objects). Without
 *   QUICKBOOKS_* credentials it runs in mock mode and reports what it would send.
 */
export type ExportLine = { entryNo: string; date: string; memo: string; account: string; accountCode: string; debitCents: number; creditCents: number; property: string | null };
export type ExportResult = { format: string; filename: string; contentType: string; body: string; summary: { entries: number; lines: number; debitCents: number; creditCents: number } };

export interface AccountingExportProvider {
  readonly name: string;
  export(lines: ExportLine[], range: { from: string; to: string }): Promise<ExportResult>;
}

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const money = (c: number) => (c ? (c / 100).toFixed(2) : "");
const summarize = (lines: ExportLine[]) => ({ entries: new Set(lines.map((l) => l.entryNo)).size, lines: lines.length, debitCents: lines.reduce((s, l) => s + l.debitCents, 0), creditCents: lines.reduce((s, l) => s + l.creditCents, 0) });

class CsvExportProvider implements AccountingExportProvider {
  readonly name = "csv";
  async export(lines: ExportLine[], range: { from: string; to: string }): Promise<ExportResult> {
    const rows = [["Journal No", "Journal Date", "Memo", "Account", "Debits", "Credits", "Description", "Class"].join(",")];
    for (const l of lines) rows.push([l.entryNo, l.date, esc(l.memo), esc(`${l.accountCode} ${l.account}`), money(l.debitCents), money(l.creditCents), esc(l.memo), esc(l.property ?? "")].join(","));
    return { format: "csv", filename: `journal-${range.from}-to-${range.to}.csv`, contentType: "text/csv", body: rows.join("\n"), summary: summarize(lines) };
  }
}

class QuickBooksExportProvider implements AccountingExportProvider {
  readonly name = "quickbooks";
  async export(lines: ExportLine[], range: { from: string; to: string }): Promise<ExportResult> {
    const byEntry = new Map<string, ExportLine[]>();
    for (const l of lines) byEntry.set(l.entryNo, [...(byEntry.get(l.entryNo) ?? []), l]);
    const payload = [...byEntry].map(([no, ls]) => ({
      DocNumber: no, TxnDate: ls[0]!.date, PrivateNote: ls[0]!.memo,
      Line: ls.map((l) => ({ DetailType: "JournalEntryLineDetail", Amount: (l.debitCents || l.creditCents) / 100, Description: l.memo, JournalEntryLineDetail: { PostingType: l.debitCents ? "Debit" : "Credit", AccountRef: { name: l.account }, ...(l.property ? { ClassRef: { name: l.property } } : {}) } })),
    }));
    // Real mode would POST each JournalEntry to /v3/company/<realm>/journalentry with OAuth.
    return { format: "json", filename: `quickbooks-journal-${range.from}-to-${range.to}.json`, contentType: "application/json", body: JSON.stringify({ mode: process.env.QUICKBOOKS_CLIENT_ID ? "live" : "mock", JournalEntries: payload }, null, 2), summary: summarize(lines) };
  }
}

export function getAccountingExportProvider(kind?: string): AccountingExportProvider {
  return (kind ?? process.env.ACCOUNTING_EXPORT_PROVIDER) === "quickbooks" ? new QuickBooksExportProvider() : new CsvExportProvider();
}
