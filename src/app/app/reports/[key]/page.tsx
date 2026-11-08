import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { ReportViewer } from "@/components/reports/report-viewer";
import { loadReport } from "@/server/reports/page-data";
import { reportMeta } from "@/lib/reports";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  return { title: reportMeta((await params).key)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!can(ctx.permissions, "reports", "view")) return <Forbidden what="reports" />;
  const d = await loadReport(ctx, key, sp);
  if (!d) notFound();
  return (
    <>
      <PageHeader eyebrow={<Link href="/app/reports" className="hover:underline">← Reports</Link>} title={d.report.title} description={d.meta.description}
        actions={key === "vendor-1099" ? (
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-muted" href={`/api/exports/1099?year=${d.params.year}&format=iris`}>Download e-file CSV</a>
            <a className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-muted" href={`/api/exports/1099?year=${d.params.year}&format=copies`} target="_blank" rel="noopener">Print recipient copies</a>
          </div>
        ) : undefined} />
      <ReportViewer meta={d.meta} params={d.params} report={d.report} options={d.options} today={d.today} />
    </>
  );
}
