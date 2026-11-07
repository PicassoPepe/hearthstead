import { notFound } from "next/navigation";
import { requireOwnerPortal, ownerReportContext } from "@/server/portal/owner-context";
import { runReport } from "@/server/reports/engine";
import { Highlights, ReportTable } from "@/components/reports/report-viewer";
import { normalizeParams, rangePresets, type ReportKey } from "@/lib/reports";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Statements" };

const OWNER_REPORTS: { key: ReportKey; label: string }[] = [
  { key: "owner-statement", label: "Owner statement" },
  { key: "profit-loss", label: "Profit & loss" },
  { key: "cash-flow", label: "Cash flow" },
  { key: "rent-roll", label: "Rent roll" },
];

export default async function OwnerStatements({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const o = await requireOwnerPortal();
  if (!o.settings.showReports) notFound();
  const sp = await searchParams;
  const key = OWNER_REPORTS.find((r) => r.key === sp.report)?.key ?? "owner-statement";
  const t = o.today.toISOString().slice(0, 10);
  // Owners can only narrow to one of their own properties; the report context enforces it too.
  const propertyId = sp.propertyId && o.propertyIds.includes(sp.propertyId) ? sp.propertyId : "";
  const params = normalizeParams({ from: sp.from ?? `${t.slice(0, 4)}-01-01`, to: sp.to ?? t, asOf: sp.to ?? t, basis: sp.basis, propertyId, ownerId: o.owner.id }, o.today);
  const report = await runReport(ownerReportContext(o), key, params, o.today);
  if (key === "rent-roll" && !o.settings.showTenantNames) for (const r of report.rows) if (r.cells.tenant && r.cells.tenant !== "—") r.cells.tenant = "Occupied";
  for (const r of report.rows) delete r.href;
  const presets = rangePresets(o.today);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Statements &amp; reports</h1>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3 print:hidden">
        <label className="grid gap-1 text-sm font-medium">Report
          <select name="report" defaultValue={key} className="h-10 rounded-lg border border-input bg-surface px-3 font-normal">{OWNER_REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        </label>
        <label className="grid gap-1 text-sm font-medium">From<input type="date" name="from" defaultValue={params.from} className="h-10 rounded-lg border border-input bg-surface px-3 font-normal" /></label>
        <label className="grid gap-1 text-sm font-medium">To<input type="date" name="to" defaultValue={params.to} className="h-10 rounded-lg border border-input bg-surface px-3 font-normal" /></label>
        <label className="grid gap-1 text-sm font-medium">Property
          <select name="propertyId" defaultValue={propertyId} className="h-10 rounded-lg border border-input bg-surface px-3 font-normal"><option value="">All my properties</option>{o.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Basis
          <select name="basis" defaultValue={params.basis} className="h-10 rounded-lg border border-input bg-surface px-3 font-normal"><option value="ACCRUAL">Accrual</option><option value="CASH">Cash</option></select>
        </label>
        <Button type="submit">Update</Button>
      </form>
      <p className="text-sm text-muted-foreground">Quick ranges: {presets.slice(0, 5).map((p, i) => <span key={p.label}>{i ? " · " : ""}<a className="text-primary underline-offset-4 hover:underline" href={`?report=${key}&from=${p.from}&to=${p.to}`}>{p.label}</a></span>)}</p>
      <h2 className="text-lg font-semibold">{report.title}</h2>
      <p className="-mt-3 text-sm text-muted-foreground">{report.subtitle}</p>
      <Highlights report={report} />
      <ReportTable report={report} linkRows={false} />
    </div>
  );
}
