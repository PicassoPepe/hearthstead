import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { Forbidden } from "@/components/patterns/forbidden";
import { Highlights, ReportTable } from "@/components/reports/report-viewer";
import { PrintButton } from "@/components/reports/print-button";
import { loadReport } from "@/server/reports/page-data";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Printable report" };

/** Print-friendly report; the browser's "Save as PDF" produces the PDF. */
export default async function ReportPrint({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!can(ctx.permissions, "reports", "view")) return <Forbidden what="reports" />;
  const d = await loadReport(ctx, key, sp);
  if (!d) notFound();
  return (
    <div className="mx-auto max-w-5xl bg-surface p-6 print:p-0">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{ctx.org.name}</p>
          <h1 className="text-2xl font-semibold">{d.report.title}</h1>
          <p className="text-sm text-muted-foreground">{d.report.subtitle} · generated {formatDate(d.today)}</p>
        </div>
        <PrintButton />
      </div>
      <Highlights report={d.report} />
      <ReportTable report={d.report} linkRows={false} />
      {d.report.notes?.map((n) => <p key={n} className="mt-2 text-xs text-muted-foreground">{n}</p>)}
    </div>
  );
}
