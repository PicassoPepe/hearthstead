/** Report catalog and the shared result shape (used by the server engine and the client viewer). */

export const REPORT_KEYS = [
  "profit-loss", "balance-sheet", "cash-flow", "general-ledger", "transactions",
  "rent-roll", "delinquency", "deposits-held", "vacancy", "lease-expirations",
  "owner-statement", "vendor-1099",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type ReportParamKind = "range" | "asOf" | "basis" | "property" | "groupBy" | "compare" | "account" | "owner" | "year";

export type CatalogEntry = { key: ReportKey; title: string; description: string; category: "Financial" | "Rentals & leasing" | "Receivables" | "Owners & vendors"; params: ReportParamKind[] };

export const REPORT_CATALOG: CatalogEntry[] = [
  { key: "profit-loss", title: "Profit & loss", description: "Income and expenses by account. Cash or accrual, by property or month, with comparisons.", category: "Financial", params: ["range", "basis", "property", "groupBy", "compare"] },
  { key: "balance-sheet", title: "Balance sheet", description: "Assets, liabilities and equity as of a date.", category: "Financial", params: ["asOf", "property"] },
  { key: "cash-flow", title: "Cash flow", description: "Cash in and out by activity, with beginning and ending cash.", category: "Financial", params: ["range", "property"] },
  { key: "general-ledger", title: "General ledger", description: "Every line by account with running balances.", category: "Financial", params: ["range", "property", "account"] },
  { key: "transactions", title: "Transactions list", description: "All journal entries in a period, line by line.", category: "Financial", params: ["range", "property"] },
  { key: "rent-roll", title: "Rent roll", description: "Every unit: tenant, lease dates, rent, deposit and balance.", category: "Rentals & leasing", params: ["asOf", "property"] },
  { key: "vacancy", title: "Vacancy", description: "Vacant units, days vacant and rent being lost.", category: "Rentals & leasing", params: ["property"] },
  { key: "lease-expirations", title: "Lease expirations", description: "Leases ending in the period, soonest first.", category: "Rentals & leasing", params: ["range", "property"] },
  { key: "delinquency", title: "Delinquency & aging", description: "Who owes what, aged current / 30 / 60 / 90+.", category: "Receivables", params: ["asOf", "property"] },
  { key: "deposits-held", title: "Security deposits held", description: "Deposit liability by lease as of a date.", category: "Receivables", params: ["asOf", "property"] },
  { key: "owner-statement", title: "Owner statement", description: "An owner's income, expenses, distributions and share, by property.", category: "Owners & vendors", params: ["range", "owner", "basis"] },
  { key: "vendor-1099", title: "1099 vendor summary", description: "Payments to 1099 vendors for a calendar year ($600 threshold).", category: "Owners & vendors", params: ["year"] },
];

export const reportMeta = (k: string) => REPORT_CATALOG.find((r) => r.key === k);

export type ColKind = "text" | "money" | "date" | "number" | "percent";
export type ReportColumn = { key: string; label: string; kind: ColKind };
export type ReportRow = { kind?: "section" | "row" | "subtotal" | "total"; depth?: number; cells: Record<string, string | number | null>; href?: string };
export type ReportResult = {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  notes?: string[];
  /** Headline figures (label → cents or count) used by the AI summary and print header. */
  highlights: { label: string; value: number; kind: "money" | "number" | "percent" }[];
};

export type ReportParams = {
  from: string;
  to: string;
  asOf: string;
  basis: "ACCRUAL" | "CASH";
  propertyId: string;
  portfolioId: string;
  groupBy: "none" | "property" | "month";
  compare: "none" | "previous_period" | "previous_year";
  accountId: string;
  ownerId: string;
  year: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fill in defaults: this month to date, today, accrual, no grouping. */
export function normalizeParams(raw: Record<string, string | undefined>, today: Date): ReportParams {
  const t = iso(today);
  const monthStart = `${t.slice(0, 7)}-01`;
  const date = (v: string | undefined, d: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d);
  const from = date(raw.from, monthStart);
  const to = date(raw.to, t);
  return {
    from: from <= to ? from : to,
    to,
    asOf: date(raw.asOf, t),
    basis: raw.basis === "CASH" ? "CASH" : "ACCRUAL",
    propertyId: raw.propertyId ?? "",
    portfolioId: raw.portfolioId ?? "",
    groupBy: raw.groupBy === "property" || raw.groupBy === "month" ? raw.groupBy : "none",
    compare: raw.compare === "previous_period" || raw.compare === "previous_year" ? raw.compare : "none",
    accountId: raw.accountId ?? "",
    ownerId: raw.ownerId ?? "",
    year: raw.year && /^\d{4}$/.test(raw.year) ? Number(raw.year) : today.getUTCFullYear() - (today.getUTCMonth() < 2 ? 1 : 0),
  };
}

export function paramsToQuery(p: Partial<ReportParams>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  return q.toString();
}

/** Date-range presets for the filter bar. */
export function rangePresets(today: Date): { label: string; from: string; to: string }[] {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  const q = Math.floor(m / 3) * 3;
  return [
    { label: "This month", from: d(y, m, 1), to: iso(today) },
    { label: "Last month", from: d(y, m - 1, 1), to: d(y, m, 0) },
    { label: "This quarter", from: d(y, q, 1), to: iso(today) },
    { label: "Year to date", from: d(y, 0, 1), to: iso(today) },
    { label: "Last year", from: d(y - 1, 0, 1), to: d(y - 1, 11, 31) },
    { label: "Last 12 months", from: d(y, m - 11, 1), to: iso(today) },
  ];
}

/** CSV with proper quoting; money columns exported as plain decimals. */
export function reportToCsv(r: ReportResult): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cell = (c: ReportColumn, v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    if (c.kind === "money" && typeof v === "number") return (v / 100).toFixed(2);
    if (c.kind === "percent" && typeof v === "number") return `${(v / 100).toFixed(1)}%`;
    return esc(String(v));
  };
  return [r.columns.map((c) => esc(c.label)).join(","), ...r.rows.map((row) => r.columns.map((c, i) => (i === 0 && row.depth ? `${"  ".repeat(row.depth)}${cell(c, row.cells[c.key])}` : cell(c, row.cells[c.key]))).join(","))].join("\n");
}

/** Per-report defaults applied when the URL doesn't set a value. */
export function reportDefaults(key: string, today: Date): Record<string, string> {
  const t = iso(today);
  if (key === "lease-expirations") return { from: t, to: iso(new Date(today.getTime() + 90 * 86_400_000)) };
  if (key === "profit-loss" || key === "cash-flow" || key === "owner-statement") return { from: `${today.getUTCFullYear()}-01-01`, to: t };
  if (key === "general-ledger" || key === "transactions") return { from: `${t.slice(0, 7)}-01`, to: t };
  return {};
}
