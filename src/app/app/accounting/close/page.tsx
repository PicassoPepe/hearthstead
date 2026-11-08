import Link from "next/link";
import { CalendarCheck2, FileDown } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CloseYearButton } from "@/components/books/close-year-button";
import { closableYears, closeStatus, previewClose } from "@/server/accounting/close";
import { orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Year-end close" };

export default async function ClosePage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view") || ctx.membership.propertyScope.length) return <Forbidden what="year-end close" />;
  const today = await orgToday(ctx);
  const [years, status] = await Promise.all([closableYears(ctx.db, today), closeStatus(ctx.db)]);
  const previews = await Promise.all(years.map((y) => previewClose(ctx.db, y.year)));
  const canClose = can(ctx.permissions, "accounting", "delete");
  const nextToClose = [...years].reverse().find((y) => !y.closed)?.year;
  const lastClosed = years.find((y) => y.closed)?.year;
  return (
    <div className="max-w-4xl">
      <PageHeader icon={<CalendarCheck2 aria-hidden />} eyebrow="Accounting" title="Year-end close" description="Closing a year moves its net income into Retained Earnings and locks the books through December 31, so nothing can be posted or voided in a closed period." />
      <p className="mb-4 text-sm">{status.closedThrough ? <>Books are closed through <strong>{formatDate(status.closedThrough)}</strong>.</> : "No years are closed yet."}</p>
      <ul className="grid gap-3">
        {years.map((y, i) => (
          <li key={y.year}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">{y.year} {y.closed ? <Badge tone="success">Closed</Badge> : <Badge>Open</Badge>}</CardTitle>
                  <CardDescription>Net income {formatMoney(previews[i]!.netIncomeCents)}{y.closed ? " · moved to retained earnings" : ""}</CardDescription>
                </div>
                {canClose && ((y.closed && y.year === lastClosed) || (!y.closed && y.year === nextToClose)) ? <CloseYearButton year={y.year} closed={y.closed} netIncomeCents={previews[i]!.netIncomeCents} /> : null}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 text-sm">
                <Link className="text-primary hover:underline" href={`/app/reports/profit-loss?from=${y.year}-01-01&to=${y.year}-12-31`}>Profit &amp; loss</Link>
                <Link className="text-primary hover:underline" href={`/app/reports/balance-sheet?asOf=${y.year}-12-31`}>Balance sheet</Link>
                <Link className="text-primary hover:underline" href={`/app/reports/vendor-1099?year=${y.year}`}>1099 summary</Link>
                <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/exports/1099?year=${y.year}&format=iris`}><FileDown className="size-4" aria-hidden /> 1099-NEC e-file CSV</a>
              </CardContent>
            </Card>
          </li>
        ))}
        {!years.length ? <li className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing to close yet — your first full year will appear here in January.</li> : null}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Close years in order. Only the most recently closed year can be reopened (by an admin), which reverses its closing entry.</p>
    </div>
  );
}
