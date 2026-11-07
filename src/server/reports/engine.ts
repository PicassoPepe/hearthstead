import type { AppContext } from "@/server/context";
import * as M from "@/server/leasing/money";
import { allocateCents } from "@/lib/money";
import { addDays, diffDays, parseISODate, toISODate, formatDate } from "@/lib/dates";
import type { ReportKey, ReportParams, ReportResult, ReportRow, ReportColumn } from "@/lib/reports";
import { reportMeta } from "@/lib/reports";

/**
 * Report engine. Every figure is computed from journal lines (or lease subledger rows that the
 * ledger invariants tie to the journal) — never from stored balances. Property scope from the
 * member's access is always applied on top of the user's filter.
 */

type Ctx = AppContext;
type Amounts = Map<string, Map<string, number>>; // accountId → column key → cents (natural sign)

const add = (m: Amounts, account: string, col: string, cents: number) => {
  if (!cents) return;
  const row = m.get(account) ?? new Map<string, number>();
  row.set(col, (row.get(col) ?? 0) + cents);
  m.set(account, row);
};

/** The property ids the report may include (null = all). */
export async function propertyFilter(ctx: Ctx, p: Pick<ReportParams, "propertyId" | "portfolioId">): Promise<string[] | null> {
  const scope = ctx.membership.propertyScope;
  let ids: string[] | null = null;
  if (p.propertyId) ids = [p.propertyId];
  else if (p.portfolioId) ids = (await ctx.db.property.findMany({ where: { portfolioId: p.portfolioId }, select: { id: true } })).map((x) => x.id);
  if (scope.length) ids = (ids ?? scope).filter((id) => scope.includes(id));
  return ids;
}
const propWhere = (ids: string[] | null) => (ids ? { propertyId: { in: ids } } : {});

async function accountsById(ctx: Ctx) {
  const accts = await ctx.db.account.findMany({ orderBy: { code: "asc" } });
  return { list: accts, byId: new Map(accts.map((a) => [a.id, a])) };
}
async function propertyNames(ctx: Ctx) {
  return new Map((await ctx.db.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
}

/**
 * Income and expense by account for a period. Accrual: every income/expense line dated in range.
 * Cash: (a) income/expense lines in entries that also move cash, (b) payments applied to
 * income charges (dated by the payment), (c) bill payments spread over the bill's lines.
 */
export async function incomeExpense(ctx: Ctx, opts: { from: string; to: string; basis: "ACCRUAL" | "CASH"; propertyIds: string[] | null; col: (date: Date, propertyId: string | null) => string }): Promise<Amounts> {
  const { list } = await accountsById(ctx);
  const ie = new Map(list.filter((a) => a.type === "INCOME" || a.type === "EXPENSE").map((a) => [a.id, a.type]));
  const sign = (accountId: string, debit: number, credit: number) => (ie.get(accountId) === "INCOME" ? credit - debit : debit - credit);
  const from = parseISODate(opts.from);
  const to = parseISODate(opts.to);
  const out: Amounts = new Map();
  if (opts.basis === "ACCRUAL") {
    const lines = await ctx.db.journalLine.findMany({
      where: { accountId: { in: [...ie.keys()] }, journalEntry: { date: { gte: from, lte: to } }, ...propWhere(opts.propertyIds) },
      select: { accountId: true, propertyId: true, debitCents: true, creditCents: true, journalEntry: { select: { date: true } } },
    });
    for (const l of lines) add(out, l.accountId, opts.col(l.journalEntry.date, l.propertyId), sign(l.accountId, l.debitCents, l.creditCents));
    return out;
  }
  const cashIds = list.filter((a) => a.isBank || a.systemKey === "UNDEPOSITED_FUNDS").map((a) => a.id);
  // (a) direct cash entries
  const direct = await ctx.db.journalLine.findMany({
    where: { accountId: { in: [...ie.keys()] }, journalEntry: { date: { gte: from, lte: to }, lines: { some: { accountId: { in: cashIds } } } }, ...propWhere(opts.propertyIds) },
    select: { accountId: true, propertyId: true, debitCents: true, creditCents: true, journalEntry: { select: { date: true } } },
  });
  for (const l of direct) add(out, l.accountId, opts.col(l.journalEntry.date, l.propertyId), sign(l.accountId, l.debitCents, l.creditCents));
  // (b) receipts applied to income charges
  const apps = await ctx.db.paymentApplication.findMany({
    where: { source: { type: "PAYMENT", voidedAt: null, date: { gte: from, lte: to } }, charge: { accountId: { in: [...ie.keys()] }, ...(opts.propertyIds ? { lease: { propertyId: { in: opts.propertyIds } } } : {}) } },
    select: { amountCents: true, source: { select: { date: true } }, charge: { select: { accountId: true, lease: { select: { propertyId: true } } } } },
  });
  for (const a of apps) add(out, a.charge.accountId!, opts.col(a.source.date, a.charge.lease.propertyId), a.amountCents);
  // (c) bill payments spread over bill lines
  const pays = await ctx.db.billPayment.findMany({ where: { voidedAt: null, date: { gte: from, lte: to } }, select: { billId: true, amountCents: true, date: true } });
  if (pays.length) {
    const bills = await ctx.db.bill.findMany({ where: { id: { in: [...new Set(pays.map((p) => p.billId))] } }, include: { lines: true } });
    for (const p of pays) {
      const b = bills.find((x) => x.id === p.billId);
      if (!b?.lines.length) continue;
      const parts = allocateCents(p.amountCents, b.lines.map((l) => l.amountCents));
      b.lines.forEach((l, i) => {
        if (opts.propertyIds && (!l.propertyId || !opts.propertyIds.includes(l.propertyId))) return;
        if (ie.has(l.accountId)) add(out, l.accountId, opts.col(p.date, l.propertyId), parts[i]!);
      });
    }
  }
  return out;
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (k > end) break;
    out.push(k);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
};
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function priorRange(p: ReportParams): { from: string; to: string } {
  const from = parseISODate(p.from);
  const to = parseISODate(p.to);
  if (p.compare === "previous_year") {
    const f = new Date(from); f.setUTCFullYear(f.getUTCFullYear() - 1);
    const t = new Date(to); t.setUTCFullYear(t.getUTCFullYear() - 1);
    return { from: toISODate(f), to: toISODate(t) };
  }
  const days = diffDays(from, to) + 1;
  return { from: toISODate(addDays(from, -days)), to: toISODate(addDays(from, -1)) };
}

const glHref = (accountId: string, p: ReportParams, extra: Record<string, string> = {}) =>
  `/app/reports/general-ledger?${new URLSearchParams({ accountId, from: p.from, to: p.to, ...(p.propertyId ? { propertyId: p.propertyId } : {}), ...extra }).toString()}`;

// ---------------------------------------------------------------- profit & loss

async function profitLoss(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const { list } = await accountsById(ctx);
  const names = await propertyNames(ctx);
  let cols: { key: string; label: string }[];
  let colOf: (d: Date, prop: string | null) => string;
  if (p.groupBy === "property") {
    colOf = (_d, prop) => prop ?? "_company";
    cols = [];
  } else if (p.groupBy === "month") {
    colOf = (d) => toISODate(d).slice(0, 7);
    cols = monthsBetween(p.from, p.to).map((k) => ({ key: k, label: monthLabel(k) }));
  } else {
    colOf = () => "amount";
    cols = [{ key: "amount", label: "Amount" }];
  }
  const cur = await incomeExpense(ctx, { from: p.from, to: p.to, basis: p.basis, propertyIds: ids, col: colOf });
  if (p.groupBy === "property") {
    const keys = new Set<string>();
    for (const m of cur.values()) for (const k of m.keys()) keys.add(k);
    cols = [...keys].sort((a, b) => (names.get(a) ?? "~").localeCompare(names.get(b) ?? "~")).map((k) => ({ key: k, label: k === "_company" ? "Company" : names.get(k) ?? "Property" }));
  }
  const comparing = p.compare !== "none" && p.groupBy === "none";
  const prior = comparing ? await incomeExpense(ctx, { ...priorRange(p), basis: p.basis, propertyIds: ids, col: () => "amount" }) : null;
  const multi = cols.length > 1;
  const columns: ReportColumn[] = [
    { key: "account", label: "Account", kind: "text" },
    ...cols.map((c) => ({ key: c.key, label: c.label, kind: "money" as const })),
    ...(multi ? [{ key: "total", label: "Total", kind: "money" as const }] : []),
    ...(comparing ? [{ key: "prior", label: p.compare === "previous_year" ? "Prior year" : "Prior period", kind: "money" as const }, { key: "change", label: "Change", kind: "money" as const }, { key: "changePct", label: "% change", kind: "percent" as const }] : []),
  ];
  const rows: ReportRow[] = [];
  const totals: Record<"INCOME" | "EXPENSE", Record<string, number>> = { INCOME: {}, EXPENSE: {} };
  for (const type of ["INCOME", "EXPENSE"] as const) {
    rows.push({ kind: "section", cells: { account: type === "INCOME" ? "Income" : "Expenses" } });
    for (const a of list.filter((x) => x.type === type)) {
      const m = cur.get(a.id);
      const pr = prior?.get(a.id)?.get("amount") ?? 0;
      if (!m?.size && !pr) continue;
      const cells: Record<string, number | string | null> = { account: `${a.code} · ${a.name}` };
      let total = 0;
      for (const c of cols) {
        const v = m?.get(c.key) ?? 0;
        cells[c.key] = v;
        total += v;
        totals[type][c.key] = (totals[type][c.key] ?? 0) + v;
      }
      if (multi) cells.total = total;
      totals[type].total = (totals[type].total ?? 0) + total;
      if (comparing) {
        cells.prior = pr;
        cells.change = total - pr;
        cells.changePct = pr ? Math.round(((total - pr) / Math.abs(pr)) * 10_000) : null;
        totals[type].prior = (totals[type].prior ?? 0) + pr;
      }
      rows.push({ depth: 1, cells, href: glHref(a.id, p) });
    }
    const t: Record<string, number | string | null> = { account: type === "INCOME" ? "Total income" : "Total expenses" };
    for (const c of cols) t[c.key] = totals[type][c.key] ?? 0;
    if (multi) t.total = totals[type].total ?? 0;
    if (comparing) {
      const tt = totals[type].total ?? 0;
      const pr = totals[type].prior ?? 0;
      Object.assign(t, { prior: pr, change: tt - pr, changePct: pr ? Math.round(((tt - pr) / Math.abs(pr)) * 10_000) : null });
    }
    rows.push({ kind: "subtotal", cells: t });
  }
  const net: Record<string, number | string | null> = { account: "Net operating income" };
  for (const k of [...cols.map((c) => c.key), ...(multi ? ["total"] : []), ...(comparing ? ["prior"] : [])]) net[k] = (totals.INCOME[k] ?? 0) - (totals.EXPENSE[k] ?? 0);
  if (comparing) {
    const n = Number(net.amount ?? 0);
    const pr = Number(net.prior ?? 0);
    Object.assign(net, { change: n - pr, changePct: pr ? Math.round(((n - pr) / Math.abs(pr)) * 10_000) : null });
  }
  rows.push({ kind: "total", cells: net });
  const inc = totals.INCOME.total ?? 0;
  const exp = totals.EXPENSE.total ?? 0;
  return {
    title: "Profit & loss",
    subtitle: `${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "CASH" ? "Cash" : "Accrual"} basis${await scopeLabel(ctx, p)}`,
    columns, rows,
    notes: p.compare !== "none" && p.groupBy !== "none" ? ["Comparison is available when not grouped."] : undefined,
    highlights: [
      { label: "Total income", value: inc, kind: "money" },
      { label: "Total expenses", value: exp, kind: "money" },
      { label: "Net operating income", value: inc - exp, kind: "money" },
      ...(comparing ? [{ label: "Prior net operating income", value: (totals.INCOME.prior ?? 0) - (totals.EXPENSE.prior ?? 0), kind: "money" as const }] : []),
      { label: "Operating margin", value: inc ? Math.round(((inc - exp) / inc) * 10_000) : 0, kind: "percent" },
    ],
  };
}

async function scopeLabel(ctx: Ctx, p: Pick<ReportParams, "propertyId" | "portfolioId">) {
  if (p.propertyId) return ` · ${(await ctx.db.property.findFirst({ where: { id: p.propertyId }, select: { name: true } }))?.name ?? "Property"}`;
  if (p.portfolioId) return ` · ${(await ctx.db.portfolio.findFirst({ where: { id: p.portfolioId }, select: { name: true } }))?.name ?? "Portfolio"}`;
  return ctx.membership.propertyScope.length ? " · Your properties" : " · All properties";
}

// ---------------------------------------------------------------- balance sheet

async function balanceSheet(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const { list } = await accountsById(ctx);
  const sums = await ctx.db.journalLine.groupBy({ by: ["accountId"], where: { journalEntry: { date: { lte: parseISODate(p.asOf) } }, ...propWhere(ids) }, _sum: { debitCents: true, creditCents: true } });
  const net = new Map(sums.map((s) => [s.accountId, (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0)]));
  const rows: ReportRow[] = [];
  const tot: Record<string, number> = {};
  for (const [type, label] of [["ASSET", "Assets"], ["LIABILITY", "Liabilities"], ["EQUITY", "Equity"]] as const) {
    rows.push({ kind: "section", cells: { account: label } });
    let t = 0;
    for (const a of list.filter((x) => x.type === type)) {
      const n = net.get(a.id) ?? 0;
      const v = type === "ASSET" ? n : -n;
      if (!v) continue;
      t += v;
      rows.push({ depth: 1, cells: { account: `${a.code} · ${a.name}`, amount: v }, href: glHref(a.id, { ...p, from: "2000-01-01", to: p.asOf }) });
    }
    if (type === "EQUITY") {
      const ni = list.filter((x) => x.type === "INCOME" || x.type === "EXPENSE").reduce((s, a) => s - (net.get(a.id) ?? 0), 0);
      rows.push({ depth: 1, cells: { account: "Net income (to date)", amount: ni } });
      t += ni;
    }
    tot[type] = t;
    rows.push({ kind: "subtotal", cells: { account: `Total ${label.toLowerCase()}`, amount: t } });
  }
  rows.push({ kind: "total", cells: { account: "Total liabilities & equity", amount: (tot.LIABILITY ?? 0) + (tot.EQUITY ?? 0) } });
  const balanced = (tot.ASSET ?? 0) === (tot.LIABILITY ?? 0) + (tot.EQUITY ?? 0);
  return {
    title: "Balance sheet",
    subtitle: `As of ${formatDate(p.asOf)}${await scopeLabel(ctx, p)}`,
    columns: [{ key: "account", label: "Account", kind: "text" }, { key: "amount", label: "Balance", kind: "money" }],
    rows,
    notes: [balanced ? "Assets equal liabilities plus equity." : "Out of balance for this property filter — company-level entries without a property make up the difference."],
    highlights: [
      { label: "Total assets", value: tot.ASSET ?? 0, kind: "money" },
      { label: "Total liabilities", value: tot.LIABILITY ?? 0, kind: "money" },
      { label: "Total equity", value: tot.EQUITY ?? 0, kind: "money" },
    ],
  };
}

// ---------------------------------------------------------------- cash flow

const FLOW: Record<string, string> = {
  LEASE_PAYMENT: "Rent & tenant receipts", LEASE_RETURNED_PAYMENT: "Rent & tenant receipts", LEASE_VOID: "Rent & tenant receipts",
  LEASE_DEPOSIT: "Security deposits received", LEASE_REFUND: "Refunds to tenants",
  BILL_PAYMENT: "Bills paid", EXPENSE: "Expenses paid", OWNER_DISTRIBUTION: "Owner distributions", OWNER_CONTRIBUTION: "Owner contributions",
  BANK_FEED: "Bank fees & interest", BANK_DEPOSIT: "Transfers between accounts", TRANSFER: "Transfers between accounts",
};

async function cashFlow(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const { list } = await accountsById(ctx);
  const cashIds = list.filter((a) => a.isBank || a.systemKey === "UNDEPOSITED_FUNDS").map((a) => a.id);
  const from = parseISODate(p.from);
  const begin = await ctx.db.journalLine.aggregate({ where: { accountId: { in: cashIds }, journalEntry: { date: { lt: from } }, ...propWhere(ids) }, _sum: { debitCents: true, creditCents: true } });
  const beginning = (begin._sum.debitCents ?? 0) - (begin._sum.creditCents ?? 0);
  const lines = await ctx.db.journalLine.findMany({
    where: { accountId: { in: cashIds }, journalEntry: { date: { gte: from, lte: parseISODate(p.to) } }, ...propWhere(ids) },
    select: { debitCents: true, creditCents: true, journalEntry: { select: { source: true, reverses: { select: { source: true } } } } },
  });
  const cat = new Map<string, number>();
  for (const l of lines) {
    const src = l.journalEntry.source === "REVERSAL" ? l.journalEntry.reverses?.source ?? "MANUAL" : l.journalEntry.source;
    const k = FLOW[src] ?? "Other";
    cat.set(k, (cat.get(k) ?? 0) + l.debitCents - l.creditCents);
  }
  const order = ["Rent & tenant receipts", "Security deposits received", "Refunds to tenants", "Owner contributions", "Bills paid", "Expenses paid", "Bank fees & interest", "Owner distributions", "Transfers between accounts", "Other"];
  const rows: ReportRow[] = [{ cells: { line: "Beginning cash", amount: beginning }, kind: "subtotal" }];
  let net = 0;
  rows.push({ kind: "section", cells: { line: "Cash in" } });
  for (const k of order) { const v = cat.get(k) ?? 0; if (v > 0) { rows.push({ depth: 1, cells: { line: k, amount: v } }); } }
  rows.push({ kind: "section", cells: { line: "Cash out" } });
  for (const k of order) { const v = cat.get(k) ?? 0; if (v < 0) { rows.push({ depth: 1, cells: { line: k, amount: v } }); } }
  for (const v of cat.values()) net += v;
  rows.push({ kind: "subtotal", cells: { line: "Net change in cash", amount: net } });
  rows.push({ kind: "total", cells: { line: "Ending cash", amount: beginning + net } });
  const inflow = [...cat.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
  return {
    title: "Cash flow",
    subtitle: `${formatDate(p.from)} – ${formatDate(p.to)}${await scopeLabel(ctx, p)} · bank accounts + undeposited funds`,
    columns: [{ key: "line", label: "Activity", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
    rows,
    highlights: [
      { label: "Beginning cash", value: beginning, kind: "money" },
      { label: "Cash in", value: inflow, kind: "money" },
      { label: "Cash out", value: inflow - net, kind: "money" },
      { label: "Ending cash", value: beginning + net, kind: "money" },
    ],
  };
}

// ---------------------------------------------------------------- general ledger & transactions

const LIMIT = 3000;

async function generalLedger(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const { list } = await accountsById(ctx);
  const names = await propertyNames(ctx);
  const from = parseISODate(p.from);
  const accts = p.accountId ? list.filter((a) => a.id === p.accountId) : list;
  const [opening, lines] = await Promise.all([
    ctx.db.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: accts.map((a) => a.id) }, journalEntry: { date: { lt: from } }, ...propWhere(ids) }, _sum: { debitCents: true, creditCents: true } }),
    ctx.db.journalLine.findMany({
      where: { accountId: { in: accts.map((a) => a.id) }, journalEntry: { date: { gte: from, lte: parseISODate(p.to) } }, ...propWhere(ids) },
      include: { journalEntry: { select: { date: true, memo: true, source: true } } },
      orderBy: [{ journalEntry: { date: "asc" } }, { createdAt: "asc" }],
      take: LIMIT + 1,
    }),
  ]);
  const rows: ReportRow[] = [];
  let debits = 0;
  let credits = 0;
  for (const a of accts) {
    const debitNormal = a.type === "ASSET" || a.type === "EXPENSE";
    const o = opening.find((x) => x.accountId === a.id);
    const openNet = (o?._sum.debitCents ?? 0) - (o?._sum.creditCents ?? 0);
    const ls = lines.slice(0, LIMIT).filter((l) => l.accountId === a.id);
    if (!ls.length && !openNet && !p.accountId) continue;
    let bal = debitNormal ? openNet : -openNet;
    rows.push({ kind: "section", cells: { date: `${a.code} · ${a.name}` } });
    rows.push({ depth: 1, cells: { date: formatDate(p.from), memo: "Opening balance", balance: bal } });
    for (const l of ls) {
      bal += debitNormal ? l.debitCents - l.creditCents : l.creditCents - l.debitCents;
      debits += l.debitCents;
      credits += l.creditCents;
      rows.push({ depth: 1, cells: { date: formatDate(l.journalEntry.date), memo: l.memo ?? l.journalEntry.memo ?? "", source: l.journalEntry.source.replace(/_/g, " ").toLowerCase(), property: l.propertyId ? names.get(l.propertyId) ?? "" : "", debit: l.debitCents || null, credit: l.creditCents || null, balance: bal } });
    }
    rows.push({ kind: "subtotal", cells: { date: `Closing — ${a.name}`, balance: bal } });
  }
  return {
    title: "General ledger",
    subtitle: `${formatDate(p.from)} – ${formatDate(p.to)}${await scopeLabel(ctx, p)}${p.accountId && accts[0] ? ` · ${accts[0].name}` : ""}`,
    columns: [
      { key: "date", label: "Date", kind: "text" }, { key: "memo", label: "Memo", kind: "text" }, { key: "source", label: "Source", kind: "text" }, { key: "property", label: "Property", kind: "text" },
      { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }, { key: "balance", label: "Balance", kind: "money" },
    ],
    rows,
    notes: lines.length > LIMIT ? [`Showing the first ${LIMIT.toLocaleString()} lines — narrow the date range or pick an account.`] : undefined,
    highlights: [{ label: "Debits", value: debits, kind: "money" }, { label: "Credits", value: credits, kind: "money" }],
  };
}

async function transactions(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const { byId } = await accountsById(ctx);
  const names = await propertyNames(ctx);
  const lines = await ctx.db.journalLine.findMany({
    where: { journalEntry: { date: { gte: parseISODate(p.from), lte: parseISODate(p.to) } }, ...propWhere(ids) },
    include: { journalEntry: { select: { date: true, memo: true, source: true } } },
    orderBy: [{ journalEntry: { date: "desc" } }, { journalEntryId: "asc" }, { createdAt: "asc" }],
    take: LIMIT + 1,
  });
  const shown = lines.slice(0, LIMIT);
  return {
    title: "Transactions list",
    subtitle: `${formatDate(p.from)} – ${formatDate(p.to)}${await scopeLabel(ctx, p)}`,
    columns: [
      { key: "date", label: "Date", kind: "date" }, { key: "source", label: "Type", kind: "text" }, { key: "memo", label: "Memo", kind: "text" }, { key: "account", label: "Account", kind: "text" },
      { key: "property", label: "Property", kind: "text" }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" },
    ],
    rows: shown.map((l) => {
      const a = byId.get(l.accountId);
      return { cells: { date: toISODate(l.journalEntry.date), source: l.journalEntry.source.replace(/_/g, " ").toLowerCase(), memo: l.journalEntry.memo ?? "", account: a ? `${a.code} · ${a.name}` : "", property: l.propertyId ? names.get(l.propertyId) ?? "" : "", debit: l.debitCents || null, credit: l.creditCents || null } };
    }),
    notes: lines.length > LIMIT ? [`Showing the first ${LIMIT.toLocaleString()} lines — narrow the date range.`] : undefined,
    highlights: [{ label: "Lines", value: shown.length, kind: "number" }, { label: "Total debits", value: shown.reduce((s, l) => s + l.debitCents, 0), kind: "money" }],
  };
}

// ---------------------------------------------------------------- rentals & receivables

const tenantName = (t: { kind: string; firstName: string | null; lastName: string | null; companyName: string | null }) => (t.kind === "COMPANY" ? t.companyName ?? "" : [t.firstName, t.lastName].filter(Boolean).join(" "));

async function leaseBalances(ctx: Ctx, asOf: Date, keys: ("ACCOUNTS_RECEIVABLE" | "PREPAID_RENT" | "DEPOSITS_HELD")[]) {
  const accts = await ctx.db.account.findMany({ where: { systemKey: { in: keys } }, select: { id: true } });
  const rows = await ctx.db.journalLine.groupBy({ by: ["leaseId"], where: { accountId: { in: accts.map((a) => a.id) }, leaseId: { not: null }, journalEntry: { date: { lte: asOf } } }, _sum: { debitCents: true, creditCents: true } });
  return new Map(rows.map((r) => [r.leaseId!, (r._sum.debitCents ?? 0) - (r._sum.creditCents ?? 0)]));
}

async function rentRoll(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const asOf = parseISODate(p.asOf);
  const units = await ctx.db.unit.findMany({
    where: { deletedAt: null, property: { deletedAt: null, ...(ids ? { id: { in: ids } } : {}) } },
    orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
    include: {
      property: { select: { id: true, name: true } },
      leases: {
        where: { lease: { status: { in: ["ACTIVE", "EVICTION", "ENDED"] }, startDate: { lte: asOf }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: asOf } }] } },
        include: { lease: { include: { tenants: { include: { tenant: true } }, recurring: { where: { kind: "RENT", deletedAt: null } } } } },
      },
    },
  });
  const [bal, dep] = await Promise.all([leaseBalances(ctx, asOf, ["ACCOUNTS_RECEIVABLE", "PREPAID_RENT"]), leaseBalances(ctx, asOf, ["DEPOSITS_HELD"])]);
  const rows: ReportRow[] = [];
  let occupied = 0;
  let rentTotal = 0;
  let balTotal = 0;
  let marketTotal = 0;
  let current = "";
  let sub = { units: 0, rent: 0, balance: 0 };
  const flush = () => { if (current) rows.push({ kind: "subtotal", cells: { unit: `${current} — ${sub.units} units`, rent: sub.rent, balance: sub.balance } }); };
  for (const u of units) {
    if (u.property.name !== current) { flush(); current = u.property.name; sub = { units: 0, rent: 0, balance: 0 }; rows.push({ kind: "section", cells: { unit: u.property.name } }); }
    const lease = u.leases[0]?.lease;
    const rent = lease ? lease.recurring.filter((r) => r.startDate <= asOf && (!r.endDate || r.endDate >= asOf)).reduce((s, r) => s + r.amountCents, 0) : 0;
    const b = lease ? bal.get(lease.id) ?? 0 : 0;
    const d = lease ? -(dep.get(lease.id) ?? 0) : 0;
    if (lease) occupied++;
    rentTotal += rent; balTotal += b; marketTotal += u.marketRentCents;
    sub.units++; sub.rent += rent; sub.balance += b;
    const primary = lease?.tenants.find((t) => t.role === "PRIMARY")?.tenant ?? lease?.tenants[0]?.tenant;
    rows.push({
      depth: 1,
      href: lease ? `/app/leasing/${lease.id}` : `/app/rentals/units/${u.id}`,
      cells: { unit: u.name, status: lease ? (lease.status === "EVICTION" ? "Eviction" : "Occupied") : "Vacant", tenant: primary ? tenantName(primary) : "—", start: lease ? toISODate(lease.startDate) : null, end: lease?.endDate ? toISODate(lease.endDate) : lease ? "Month-to-month" : null, market: u.marketRentCents, rent, deposit: d, balance: b },
    });
  }
  flush();
  rows.push({ kind: "total", cells: { unit: `All units — ${units.length}`, market: marketTotal, rent: rentTotal, balance: balTotal } });
  return {
    title: "Rent roll",
    subtitle: `As of ${formatDate(p.asOf)}${await scopeLabel(ctx, p)}`,
    columns: [
      { key: "unit", label: "Unit", kind: "text" }, { key: "status", label: "Status", kind: "text" }, { key: "tenant", label: "Tenant", kind: "text" }, { key: "start", label: "Lease start", kind: "date" }, { key: "end", label: "Lease end", kind: "text" },
      { key: "market", label: "Market rent", kind: "money" }, { key: "rent", label: "Rent", kind: "money" }, { key: "deposit", label: "Deposit held", kind: "money" }, { key: "balance", label: "Balance", kind: "money" },
    ],
    rows,
    highlights: [
      { label: "Units", value: units.length, kind: "number" },
      { label: "Occupancy", value: units.length ? Math.round((occupied / units.length) * 10_000) : 0, kind: "percent" },
      { label: "Scheduled rent", value: rentTotal, kind: "money" },
      { label: "Rent vs market", value: marketTotal ? Math.round((rentTotal / marketTotal) * 10_000) : 0, kind: "percent" },
      { label: "Outstanding balances", value: balTotal, kind: "money" },
    ],
  };
}

async function delinquency(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const asOf = parseISODate(p.asOf);
  const bal = await leaseBalances(ctx, asOf, ["ACCOUNTS_RECEIVABLE", "PREPAID_RENT"]);
  const owing = [...bal].filter(([, v]) => v > 0).map(([k]) => k);
  const leases = await ctx.db.lease.findMany({ where: { id: { in: owing }, ...(ids ? { propertyId: { in: ids } } : {}) }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } }, tenants: { include: { tenant: true } } } });
  const buckets = ["current", "d30", "d60", "d90", "d90p"] as const;
  const totals: Record<string, number> = Object.fromEntries([...buckets, "prepaid", "balance"].map((b) => [b, 0]));
  const rows: ReportRow[] = [];
  for (const l of leases) {
    const [open, unapplied] = await ctx.db.tx(async (tx) => [await M.openCharges(tx, l.id), await M.unappliedSources(tx, l.id)] as const);
    const cells: Record<string, number | string | null> = Object.fromEntries(buckets.map((b) => [b, 0]));
    for (const c of open) {
      if (c.date > asOf) continue;
      const late = diffDays(c.dueDate, asOf);
      const b = late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "d90p";
      cells[b] = Number(cells[b]) + c.remainingCents;
    }
    const prepaid = unapplied.reduce((s, u) => s + u.unappliedCents, 0);
    const balance = buckets.reduce((s, b) => s + Number(cells[b]), 0) - prepaid;
    if (balance <= 0) continue;
    const primary = l.tenants.find((t) => t.role === "PRIMARY")?.tenant ?? l.tenants[0]?.tenant;
    Object.assign(cells, { tenant: primary ? tenantName(primary) : "Tenant", unit: `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`, status: l.status === "EVICTION" ? "Eviction" : l.status === "ENDED" ? "Past tenant" : "Current", prepaid: prepaid ? -prepaid : 0, balance });
    for (const k of [...buckets, "balance"]) totals[k]! += Number(cells[k]);
    totals.prepaid! += prepaid ? -prepaid : 0;
    rows.push({ cells, href: `/app/leasing/${l.id}?tab=ledger` });
  }
  rows.sort((a, b) => Number(b.cells.balance) - Number(a.cells.balance));
  rows.push({ kind: "total", cells: { tenant: `${rows.length} tenants`, ...totals } });
  return {
    title: "Delinquency & aging",
    subtitle: `As of ${formatDate(p.asOf)}${await scopeLabel(ctx, p)} · days past due`,
    columns: [
      { key: "tenant", label: "Tenant", kind: "text" }, { key: "unit", label: "Property · unit", kind: "text" }, { key: "status", label: "Status", kind: "text" },
      { key: "current", label: "Not yet due", kind: "money" }, { key: "d30", label: "1–30", kind: "money" }, { key: "d60", label: "31–60", kind: "money" }, { key: "d90", label: "61–90", kind: "money" }, { key: "d90p", label: "90+", kind: "money" },
      { key: "prepaid", label: "Credits", kind: "money" }, { key: "balance", label: "Balance", kind: "money" },
    ],
    rows,
    highlights: [
      { label: "Total owed", value: totals.balance ?? 0, kind: "money" },
      { label: "Tenants owing", value: rows.length - 1, kind: "number" },
      { label: "Over 30 days", value: (totals.d60 ?? 0) + (totals.d90 ?? 0) + (totals.d90p ?? 0), kind: "money" },
      { label: "Over 90 days", value: totals.d90p ?? 0, kind: "money" },
    ],
  };
}

async function depositsHeld(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const dep = await leaseBalances(ctx, parseISODate(p.asOf), ["DEPOSITS_HELD"]);
  const held = [...dep].filter(([, v]) => v < 0);
  const leases = await ctx.db.lease.findMany({ where: { id: { in: held.map(([k]) => k) }, ...(ids ? { propertyId: { in: ids } } : {}) }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } }, tenants: { include: { tenant: true } } }, orderBy: { property: { name: "asc" } } });
  let total = 0;
  const rows: ReportRow[] = leases.map((l) => {
    const amount = -(dep.get(l.id) ?? 0);
    total += amount;
    const primary = l.tenants.find((t) => t.role === "PRIMARY")?.tenant ?? l.tenants[0]?.tenant;
    return { href: `/app/leasing/${l.id}`, cells: { tenant: primary ? tenantName(primary) : "", property: l.property.name, unit: l.units.map((u) => u.unit.name).join(", "), status: l.status.toLowerCase(), amount } };
  });
  rows.push({ kind: "total", cells: { tenant: `${leases.length} leases`, amount: total } });
  return {
    title: "Security deposits held",
    subtitle: `As of ${formatDate(p.asOf)}${await scopeLabel(ctx, p)}`,
    columns: [{ key: "tenant", label: "Tenant", kind: "text" }, { key: "property", label: "Property", kind: "text" }, { key: "unit", label: "Unit", kind: "text" }, { key: "status", label: "Lease", kind: "text" }, { key: "amount", label: "Held", kind: "money" }],
    rows,
    highlights: [{ label: "Deposits held", value: total, kind: "money" }, { label: "Leases", value: leases.length, kind: "number" }],
  };
}

async function vacancy(ctx: Ctx, p: ReportParams, today: Date): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const units = await ctx.db.unit.findMany({
    where: { deletedAt: null, property: { deletedAt: null, ...(ids ? { id: { in: ids } } : {}) } },
    orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
    include: { property: { select: { name: true } }, leases: { include: { lease: { select: { status: true, startDate: true, moveOutDate: true, endDate: true } } } } },
  });
  const rows: ReportRow[] = [];
  let lost = 0;
  for (const u of units) {
    const ls = u.leases.map((x) => x.lease).filter((l) => l.status !== "DRAFT");
    const occ = ls.some((l) => ["ACTIVE", "EVICTION"].includes(l.status) && l.startDate <= today && (!l.moveOutDate || l.moveOutDate >= today));
    if (occ) continue;
    const lastOut = ls.map((l) => l.moveOutDate ?? l.endDate).filter((d): d is Date => !!d && d <= today).sort((a, b) => b.getTime() - a.getTime())[0];
    const since = lastOut ?? u.createdAt;
    const days = Math.max(0, diffDays(since, today));
    const upcoming = ls.find((l) => l.startDate > today);
    lost += u.marketRentCents;
    rows.push({ href: `/app/rentals/units/${u.id}`, cells: { property: u.property.name, unit: u.name, beds: u.beds ?? null, sqft: u.sqft ?? null, since: toISODate(since), days, market: u.marketRentCents, next: upcoming ? `Lease starts ${formatDate(upcoming.startDate)}` : u.isListed ? "Listed" : "Not listed" } });
  }
  rows.push({ kind: "total", cells: { property: `${rows.length} vacant of ${units.length}`, market: lost } });
  return {
    title: "Vacancy",
    subtitle: `As of ${formatDate(today)}${await scopeLabel(ctx, p)}`,
    columns: [
      { key: "property", label: "Property", kind: "text" }, { key: "unit", label: "Unit", kind: "text" }, { key: "beds", label: "Beds", kind: "number" }, { key: "sqft", label: "Sq ft", kind: "number" },
      { key: "since", label: "Vacant since", kind: "date" }, { key: "days", label: "Days vacant", kind: "number" }, { key: "market", label: "Market rent", kind: "money" }, { key: "next", label: "Status", kind: "text" },
    ],
    rows,
    highlights: [{ label: "Vacant units", value: rows.length - 1, kind: "number" }, { label: "Vacancy rate", value: units.length ? Math.round(((rows.length - 1) / units.length) * 10_000) : 0, kind: "percent" }, { label: "Monthly rent at risk", value: lost, kind: "money" }],
  };
}

async function leaseExpirations(ctx: Ctx, p: ReportParams, today: Date): Promise<ReportResult> {
  const ids = await propertyFilter(ctx, p);
  const leases = await ctx.db.lease.findMany({
    where: { status: { in: ["ACTIVE", "EVICTION"] }, endDate: { gte: parseISODate(p.from), lte: parseISODate(p.to) }, ...(ids ? { propertyId: { in: ids } } : {}) },
    orderBy: { endDate: "asc" },
    include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true, marketRentCents: true } } } }, tenants: { include: { tenant: true } }, recurring: { where: { kind: "RENT", deletedAt: null } } },
  });
  let rent = 0;
  const rows: ReportRow[] = leases.map((l) => {
    const r = l.recurring.reduce((s, x) => s + x.amountCents, 0);
    const market = l.units.reduce((s, u) => s + u.unit.marketRentCents, 0);
    rent += r;
    const primary = l.tenants.find((t) => t.role === "PRIMARY")?.tenant ?? l.tenants[0]?.tenant;
    return { href: `/app/leasing/${l.id}`, cells: { tenant: primary ? tenantName(primary) : "", property: l.property.name, unit: l.units.map((u) => u.unit.name).join(", "), end: toISODate(l.endDate!), days: diffDays(today, l.endDate!), rent: r, market, gap: market - r, notice: l.noticeGivenAt ? "Notice given" : "—" } };
  });
  rows.push({ kind: "total", cells: { tenant: `${leases.length} leases`, rent } });
  const in30 = leases.filter((l) => diffDays(today, l.endDate!) <= 30).length;
  return {
    title: "Lease expirations",
    subtitle: `Ending ${formatDate(p.from)} – ${formatDate(p.to)}${await scopeLabel(ctx, p)}`,
    columns: [
      { key: "tenant", label: "Tenant", kind: "text" }, { key: "property", label: "Property", kind: "text" }, { key: "unit", label: "Unit", kind: "text" }, { key: "end", label: "Ends", kind: "date" },
      { key: "days", label: "Days left", kind: "number" }, { key: "rent", label: "Current rent", kind: "money" }, { key: "market", label: "Market rent", kind: "money" }, { key: "gap", label: "Gap to market", kind: "money" }, { key: "notice", label: "Notice", kind: "text" },
    ],
    rows,
    highlights: [{ label: "Leases expiring", value: leases.length, kind: "number" }, { label: "Within 30 days", value: in30, kind: "number" }, { label: "Rent expiring", value: rent, kind: "money" }],
  };
}

// ---------------------------------------------------------------- owners & vendors

async function ownerStatement(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const owner = p.ownerId ? await ctx.db.owner.findFirst({ where: { id: p.ownerId } }) : await ctx.db.owner.findFirst({ where: { ownerships: { some: {} } }, orderBy: { lastName: "asc" } });
  const empty: ReportResult = { title: "Owner statement", subtitle: "Choose an owner", columns: [{ key: "line", label: "Line", kind: "text" }], rows: [], highlights: [] };
  if (!owner) return empty;
  const scope = ctx.membership.propertyScope;
  const allowed = p.propertyId ? (scope.length ? scope.filter((id) => id === p.propertyId) : [p.propertyId]) : scope;
  const owns = await ctx.db.propertyOwnership.findMany({ where: { ownerId: owner.id, deletedAt: null, ...(allowed.length || p.propertyId ? { propertyId: { in: allowed } } : {}) }, include: { property: { select: { id: true, name: true } } }, orderBy: { property: { name: "asc" } } });
  const { list } = await accountsById(ctx);
  const ie = await incomeExpense(ctx, { from: p.from, to: p.to, basis: p.basis, propertyIds: owns.map((o) => o.propertyId), col: (_d, prop) => prop ?? "_" });
  const dists = await ctx.db.ownerDistribution.findMany({ where: { ownerId: owner.id, date: { gte: parseISODate(p.from), lte: parseISODate(p.to) } } });
  const rows: ReportRow[] = [];
  let incomeShare = 0;
  let expenseShare = 0;
  let distTotal = 0;
  let contribTotal = 0;
  for (const o of owns) {
    const pct = o.percentBps / 10_000;
    rows.push({ kind: "section", cells: { line: `${o.property.name} — ${o.percentBps / 100}% ownership` } });
    let inc = 0;
    let exp = 0;
    for (const type of ["INCOME", "EXPENSE"] as const) {
      for (const a of list.filter((x) => x.type === type)) {
        const v = ie.get(a.id)?.get(o.propertyId) ?? 0;
        if (!v) continue;
        if (type === "INCOME") inc += v; else exp += v;
        rows.push({ depth: 1, cells: { line: `${type === "INCOME" ? "" : "Less: "}${a.name}`, property: type === "INCOME" ? v : -v, share: Math.round((type === "INCOME" ? v : -v) * pct) } });
      }
    }
    const net = inc - exp;
    rows.push({ kind: "subtotal", cells: { line: "Net income", property: net, share: Math.round(net * pct) } });
    const d = dists.filter((x) => x.propertyId === o.propertyId && x.kind === "DISTRIBUTION").reduce((s, x) => s + x.amountCents, 0);
    const c = dists.filter((x) => x.propertyId === o.propertyId && x.kind === "CONTRIBUTION").reduce((s, x) => s + x.amountCents, 0);
    if (d) rows.push({ depth: 1, cells: { line: "Distributions paid to you", share: -d } });
    if (c) rows.push({ depth: 1, cells: { line: "Contributions from you", share: c } });
    incomeShare += Math.round(inc * pct);
    expenseShare += Math.round(exp * pct);
    distTotal += d;
    contribTotal += c;
  }
  rows.push({ kind: "total", cells: { line: "Your net income (all properties)", share: incomeShare - expenseShare } });
  const name = owner.kind === "COMPANY" ? owner.companyName ?? "Owner" : [owner.firstName, owner.lastName].filter(Boolean).join(" ");
  return {
    title: `Owner statement — ${name}`,
    subtitle: `${formatDate(p.from)} – ${formatDate(p.to)} · ${p.basis === "CASH" ? "Cash" : "Accrual"} basis · ${owns.length} propert${owns.length === 1 ? "y" : "ies"}`,
    columns: [{ key: "line", label: "Line", kind: "text" }, { key: "property", label: "Property total", kind: "money" }, { key: "share", label: "Your share", kind: "money" }],
    rows,
    highlights: [
      { label: "Your income", value: incomeShare, kind: "money" },
      { label: "Your expenses", value: expenseShare, kind: "money" },
      { label: "Your net income", value: incomeShare - expenseShare, kind: "money" },
      { label: "Distributions paid", value: distTotal, kind: "money" },
      ...(contribTotal ? [{ label: "Contributions", value: contribTotal, kind: "money" as const }] : []),
    ],
  };
}

async function vendor1099(ctx: Ctx, p: ReportParams): Promise<ReportResult> {
  const from = parseISODate(`${p.year}-01-01`);
  const to = parseISODate(`${p.year}-12-31`);
  const [vendors, pays, expenses] = await Promise.all([
    ctx.db.vendor.findMany({ orderBy: { name: "asc" } }),
    ctx.db.billPayment.findMany({ where: { voidedAt: null, date: { gte: from, lte: to } }, select: { billId: true, amountCents: true } }),
    ctx.db.expense.findMany({ where: { voidedAt: null, vendorId: { not: null }, date: { gte: from, lte: to } }, select: { vendorId: true, totalCents: true } }),
  ]);
  const bills = await ctx.db.bill.findMany({ where: { id: { in: [...new Set(pays.map((x) => x.billId))] } }, select: { id: true, vendorId: true } });
  const paid = new Map<string, number>();
  for (const x of pays) { const v = bills.find((b) => b.id === x.billId)?.vendorId; if (v) paid.set(v, (paid.get(v) ?? 0) + x.amountCents); }
  for (const e of expenses) paid.set(e.vendorId!, (paid.get(e.vendorId!) ?? 0) + e.totalCents);
  const rows: ReportRow[] = [];
  let need = 0;
  let total = 0;
  for (const v of vendors) {
    const amt = paid.get(v.id) ?? 0;
    if (!amt) continue;
    const required = v.send1099 && amt >= 60_000;
    if (required) need++;
    total += amt;
    rows.push({ href: `/app/people/vendors/${v.id}`, cells: { vendor: v.name, tin: v.taxIdLast4 ? `•••••${v.taxIdLast4}` : "Missing", w9: v.w9OnFile ? "On file" : "Missing", eligible: v.send1099 ? "Yes" : "No (exempt)", amount: amt, required: required ? (v.w9OnFile && v.taxIdLast4 ? "File 1099-NEC" : "File — collect W-9 first") : "—" } });
  }
  rows.push({ kind: "total", cells: { vendor: `${rows.length} vendors paid`, amount: total } });
  return {
    title: "1099 vendor summary",
    subtitle: `Calendar year ${p.year} · bill payments and expenses linked to vendors · $600 threshold`,
    columns: [{ key: "vendor", label: "Vendor", kind: "text" }, { key: "tin", label: "Tax ID", kind: "text" }, { key: "w9", label: "W-9", kind: "text" }, { key: "eligible", label: "1099 vendor", kind: "text" }, { key: "amount", label: "Paid", kind: "money" }, { key: "required", label: "Action", kind: "text" }],
    rows,
    highlights: [{ label: "Vendors needing a 1099", value: need, kind: "number" }, { label: "Total paid to vendors", value: total, kind: "money" }],
  };
}

export async function runReport(ctx: Ctx, key: ReportKey, p: ReportParams, today: Date): Promise<ReportResult> {
  if (!reportMeta(key)) throw new Error("Unknown report");
  switch (key) {
    case "profit-loss": return profitLoss(ctx, p);
    case "balance-sheet": return balanceSheet(ctx, p);
    case "cash-flow": return cashFlow(ctx, p);
    case "general-ledger": return generalLedger(ctx, p);
    case "transactions": return transactions(ctx, p);
    case "rent-roll": return rentRoll(ctx, p);
    case "delinquency": return delinquency(ctx, p);
    case "deposits-held": return depositsHeld(ctx, p);
    case "vacancy": return vacancy(ctx, p, today);
    case "lease-expirations": return leaseExpirations(ctx, p, today);
    case "owner-statement": return ownerStatement(ctx, p);
    case "vendor-1099": return vendor1099(ctx, p);
  }
}
