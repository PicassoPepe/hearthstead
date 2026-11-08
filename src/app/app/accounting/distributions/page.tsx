import { HandCoins as HandCoinsIcon } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DistributionsTable } from "@/components/books/owner-views";
import { availableCash } from "@/server/accounting/owners";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Owner distributions" };

export default async function DistributionsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [rows, history, owners, props] = await Promise.all([
    availableCash(ctx.db),
    ctx.db.ownerDistribution.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 }),
    ctx.db.owner.findMany({ select: { id: true, firstName: true, lastName: true, companyName: true, kind: true } }),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ]);
  const on = (id: string) => { const o = owners.find((x) => x.id === id); return o ? (o.kind === "COMPANY" ? o.companyName : [o.firstName, o.lastName].filter(Boolean).join(" ")) ?? "" : ""; };
  const month = toISODate(new Date()).slice(0, 7);
  return (
    <>
      <PageHeader icon={<HandCoinsIcon aria-hidden />} eyebrow="Accounting" title="Owner distributions" description="Available cash = cash in the bank and undeposited − prepaid rent − open bills − reserve. Security deposits are never distributed." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Available to distribute" value={formatMoney(rows.reduce((s, r) => s + r.availableCents, 0))} hint={`${rows.filter((r) => r.availableCents > 0).length} properties`} />
        <StatCard label="Distributed this month" value={formatMoney(history.filter((h) => h.kind === "DISTRIBUTION" && toISODate(h.date).startsWith(month)).reduce((s, h) => s + h.amountCents, 0))} />
        <StatCard label="Reserves held" value={formatMoney(rows.reduce((s, r) => s + r.reserveCents, 0))} hint="Set per property" />
      </div>
      <DistributionsTable rows={rows} today={toISODate(new Date())} canEdit={can(ctx.permissions, "accounting", "edit")} />
      <Card className="mt-6">
        <CardHeader><CardTitle>Recent distributions &amp; contributions</CardTitle></CardHeader>
        <CardContent>
          {history.length ? (
            <table className="w-full text-sm">
              <caption className="sr-only">History</caption>
              <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Date</th><th scope="col">Owner</th><th scope="col">Property</th><th scope="col">Type</th><th scope="col" className="text-right">Amount</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id} className="border-t border-border"><td className="py-2">{formatDate(h.date)}</td><td>{on(h.ownerId)}</td><td>{props.find((p) => p.id === h.propertyId)?.name}</td><td>{h.kind === "DISTRIBUTION" ? `Distribution · ${h.method}` : "Contribution"}</td><td className="text-right tabular">{h.kind === "DISTRIBUTION" ? "−" : "+"}{formatMoney(h.amountCents)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="text-sm text-muted-foreground">No distributions yet.</p>}
        </CardContent>
      </Card>
    </>
  );
}
