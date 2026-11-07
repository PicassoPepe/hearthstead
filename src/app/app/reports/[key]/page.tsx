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
      <PageHeader eyebrow={<Link href="/app/reports" className="hover:underline">← Reports</Link>} title={d.report.title} description={d.meta.description} />
      <ReportViewer meta={d.meta} params={d.params} report={d.report} options={d.options} today={d.today} />
    </>
  );
}
