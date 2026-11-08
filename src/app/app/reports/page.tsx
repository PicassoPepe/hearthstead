import { BarChart3 as BarChart3Icon } from "lucide-react";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { REPORT_CATALOG } from "@/lib/reports";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "reports", "view")) return <Forbidden what="reports" />;
  const cats = [...new Set(REPORT_CATALOG.map((r) => r.category))];
  return (
    <>
      <PageHeader icon={<BarChart3Icon aria-hidden />} title="Reports" description="Every number is computed live from the ledger. Filter, compare, export to CSV or PDF, or ask for an AI summary." />
      <div className="grid gap-6 lg:grid-cols-2">
        {cats.map((c) => (
          <section key={c} aria-labelledby={`cat-${c}`} className="rounded-card border border-border bg-surface shadow-card">
            <h2 id={`cat-${c}`} className="border-b border-border px-4 py-3 font-semibold">{c}</h2>
            <ul className="divide-y divide-border">
              {REPORT_CATALOG.filter((r) => r.category === c).map((r) => (
                <li key={r.key}>
                  <Link href={`/app/reports/${r.key}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted/50">
                    <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><BarChart3 className="size-4" /></span>
                    <span className="flex-1"><span className="block font-medium">{r.title}</span><span className="block text-sm text-muted-foreground">{r.description}</span></span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
