"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { paramsToQuery, rangePresets, reportToCsv, type CatalogEntry, type ReportParams, type ReportResult, type ReportColumn } from "@/lib/reports";
import { summarizeReportAction } from "@/server/actions/reports";
import { cn } from "@/lib/utils";

export type ReportOptions = {
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
  accounts: { id: string; label: string }[];
  owners: { id: string; name: string }[];
};

export function formatCell(c: ReportColumn, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.kind === "money" && typeof v === "number") return formatMoney(v);
  if (c.kind === "percent" && typeof v === "number") return `${(v / 100).toFixed(1)}%`;
  if (c.kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  if (c.kind === "number" && typeof v === "number") return v.toLocaleString();
  return String(v);
}

export function ReportTable({ report, linkRows = true }: { report: ReportResult; linkRows?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card print:overflow-visible print:border-0 print:shadow-none">
      <table className="w-full text-sm">
        <caption className="sr-only">{report.title} — {report.subtitle}</caption>
        <thead className="bg-surface-muted/60 text-xs text-muted-foreground">
          <tr>
            {report.columns.map((c) => <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-medium", c.kind === "text" || c.kind === "date" ? "text-left" : "text-right")}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {report.rows.length ? report.rows.map((r, i) => (
            <tr key={i} className={cn("border-t border-border", r.kind === "section" && "bg-surface-muted/30", (r.kind === "subtotal" || r.kind === "total") && "font-semibold", r.kind === "total" && "border-t-2 border-foreground/30")}>
              {report.columns.map((c, ci) => {
                const v = formatCell(c, r.cells[c.key]);
                const first = ci === 0;
                const content = first && r.href && linkRows ? <Link href={r.href} className="text-primary hover:underline">{v}</Link> : v;
                const Tag = first ? "th" : "td";
                return (
                  <Tag key={c.key} scope={first ? "row" : undefined} className={cn("px-3 py-1.5 font-normal", c.kind === "text" || c.kind === "date" ? "text-left" : "text-right tabular", first && r.depth ? "pl-8" : "", first && (r.kind === "section" || r.kind === "subtotal" || r.kind === "total") && "font-semibold", typeof r.cells[c.key] === "number" && (r.cells[c.key] as number) < 0 && c.kind === "money" && "text-danger")}>
                    {content}
                  </Tag>
                );
              })}
            </tr>
          )) : <tr><td colSpan={report.columns.length} className="px-3 py-8 text-center text-muted-foreground">No data for these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Highlights({ report }: { report: ReportResult }) {
  if (!report.highlights.length) return null;
  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5 print:grid-cols-5">
      {report.highlights.map((h) => (
        <div key={h.label} className="rounded-card border border-border bg-surface p-3 shadow-card print:shadow-none">
          <dt className="text-xs text-muted-foreground">{h.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular">{h.kind === "money" ? formatMoney(h.value) : h.kind === "percent" ? `${(h.value / 100).toFixed(1)}%` : h.value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportViewer({ meta, params, report, options, today }: { meta: CatalogEntry; params: ReportParams; report: ReportResult; options: ReportOptions; today: string }) {
  const router = useRouter();
  const [summary, setSummary] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pending, start] = React.useTransition();
  const has = (k: string) => meta.params.includes(k as never);
  const query = paramsToQuery(pick(params, meta.params));
  const go = (patch: Partial<ReportParams>) => {
    setSummary(null);
    start(() => router.push(`/app/reports/${meta.key}?${paramsToQuery(pick({ ...params, ...patch }, meta.params))}`));
  };
  const presets = rangePresets(new Date(`${today}T00:00:00Z`));
  const scopeValue = params.propertyId ? `p:${params.propertyId}` : params.portfolioId ? `f:${params.portfolioId}` : "";

  return (
    <div className="grid gap-4">
      <form aria-label="Report filters" className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3 shadow-card print:hidden" onSubmit={(e) => e.preventDefault()}>
        {has("range") ? (
          <>
            <Field label="Period">{(a) => (
              <NativeSelect {...a} className="w-40" value={presets.find((x) => x.from === params.from && x.to === params.to)?.label ?? ""} onChange={(e) => { const pr = presets.find((x) => x.label === e.target.value); if (pr) go({ from: pr.from, to: pr.to }); }}>
                <option value="">Custom</option>
                {presets.map((pr) => <option key={pr.label} value={pr.label}>{pr.label}</option>)}
              </NativeSelect>
            )}</Field>
            <Field label="From">{(a) => <Input {...a} type="date" className="w-40" value={params.from} onChange={(e) => e.target.value && go({ from: e.target.value })} />}</Field>
            <Field label="To">{(a) => <Input {...a} type="date" className="w-40" value={params.to} onChange={(e) => e.target.value && go({ to: e.target.value })} />}</Field>
          </>
        ) : null}
        {has("asOf") ? <Field label="As of">{(a) => <Input {...a} type="date" className="w-40" value={params.asOf} onChange={(e) => e.target.value && go({ asOf: e.target.value })} />}</Field> : null}
        {has("year") ? <Field label="Year">{(a) => <NativeSelect {...a} className="w-28" value={params.year} onChange={(e) => go({ year: Number(e.target.value) })}>{[0, 1, 2].map((d) => Number(today.slice(0, 4)) - d).map((y) => <option key={y} value={y}>{y}</option>)}</NativeSelect>}</Field> : null}
        {has("basis") ? <Field label="Basis">{(a) => <NativeSelect {...a} className="w-32" value={params.basis} onChange={(e) => go({ basis: e.target.value as ReportParams["basis"] })}><option value="ACCRUAL">Accrual</option><option value="CASH">Cash</option></NativeSelect>}</Field> : null}
        {has("property") ? (
          <Field label="Properties">{(a) => (
            <NativeSelect {...a} className="w-56" value={scopeValue} onChange={(e) => { const v = e.target.value; go({ propertyId: v.startsWith("p:") ? v.slice(2) : "", portfolioId: v.startsWith("f:") ? v.slice(2) : "" }); }}>
              <option value="">All properties</option>
              {options.portfolios.length ? <optgroup label="Portfolios">{options.portfolios.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.name}</option>)}</optgroup> : null}
              <optgroup label="Properties">{options.properties.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
            </NativeSelect>
          )}</Field>
        ) : null}
        {has("groupBy") ? <Field label="Columns">{(a) => <NativeSelect {...a} className="w-36" value={params.groupBy} onChange={(e) => go({ groupBy: e.target.value as ReportParams["groupBy"] })}><option value="none">Total only</option><option value="property">By property</option><option value="month">By month</option></NativeSelect>}</Field> : null}
        {has("compare") ? <Field label="Compare to">{(a) => <NativeSelect {...a} className="w-40" value={params.compare} onChange={(e) => go({ compare: e.target.value as ReportParams["compare"] })}><option value="none">No comparison</option><option value="previous_period">Previous period</option><option value="previous_year">Same period last year</option></NativeSelect>}</Field> : null}
        {has("account") ? <Field label="Account">{(a) => <NativeSelect {...a} className="w-60" value={params.accountId} onChange={(e) => go({ accountId: e.target.value })}><option value="">All accounts</option>{options.accounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field> : null}
        {has("owner") ? <Field label="Owner">{(a) => <NativeSelect {...a} className="w-56" value={params.ownerId} onChange={(e) => go({ ownerId: e.target.value })}><option value="">First owner</option>{options.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect>}</Field> : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            const blob = new Blob([reportToCsv(report)], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${meta.key}-${today}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}><Download aria-hidden /> CSV</Button>
          <Button asChild variant="secondary" size="sm"><a href={`/app/reports/${meta.key}/print?${query}`} target="_blank" rel="noreferrer"><Printer aria-hidden /> PDF</a></Button>
          <Button type="button" size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await summarizeReportAction(meta.key, Object.fromEntries(new URLSearchParams(query)));
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            setSummary(r.data);
          }}><Sparkles aria-hidden /> AI summary</Button>
        </div>
      </form>
      <div aria-live="polite">
        {summary ? (
          <section aria-label="AI summary" className="rounded-card border border-primary/30 bg-primary-soft/40 p-4 text-sm">
            <p className="mb-1 flex items-center gap-1.5 font-medium"><Sparkles className="size-4" aria-hidden /> AI summary</p>
            <p>{summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">Generated from the headline figures above. Check before sharing.</p>
          </section>
        ) : null}
      </div>
      <div className={cn("grid gap-4 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        <p className="text-sm text-muted-foreground">{report.subtitle}</p>
        <Highlights report={report} />
        <ReportTable report={report} />
        {report.notes?.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
      </div>
    </div>
  );
}

function pick(p: ReportParams, kinds: CatalogEntry["params"]): Partial<ReportParams> {
  const out: Partial<ReportParams> = {};
  if (kinds.includes("range")) Object.assign(out, { from: p.from, to: p.to });
  if (kinds.includes("asOf")) out.asOf = p.asOf;
  if (kinds.includes("basis")) out.basis = p.basis;
  if (kinds.includes("property")) Object.assign(out, { propertyId: p.propertyId, portfolioId: p.portfolioId });
  if (kinds.includes("groupBy")) out.groupBy = p.groupBy;
  if (kinds.includes("compare")) out.compare = p.compare;
  if (kinds.includes("account")) out.accountId = p.accountId;
  if (kinds.includes("owner")) out.ownerId = p.ownerId;
  if (kinds.includes("year")) out.year = p.year;
  return out;
}
