import Link from "next/link";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunFeesButton } from "@/components/books/owner-views";
import { previousPeriod } from "@/server/accounting/owners";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Management fees" };

export default async function ManagementFeesPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [runs, rules, props] = await Promise.all([
    ctx.db.managementFeeRun.findMany({ orderBy: [{ period: "desc" }, { createdAt: "desc" }], take: 300 }),
    ctx.db.managementFeeRule.findMany(),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ]);
  const def = rules.find((r) => r.propertyId === null);
  const periods = [...new Set(runs.map((r) => r.period))];
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Management fees"
        description={def ? `Default: ${def.type === "PERCENT" ? `${def.percentBps / 100}% of ${def.basis === "COLLECTED_RENT" ? "collected rent" : "collected income"}${def.minimumCents ? `, minimum ${formatMoney(def.minimumCents)}` : ""}` : "flat"} · ${rules.length - 1} property overrides. Runs automatically each night for last month.` : "No fee rules yet — set them up in Settings."}
        actions={<Button asChild variant="secondary"><Link href="/app/settings/management-fees">Fee rules</Link></Button>}
      />
      {can(ctx.permissions, "accounting", "edit") ? <Card className="mb-4"><CardContent className="pt-4"><RunFeesButton defaultPeriod={previousPeriod(new Date())} /></CardContent></Card> : null}
      {periods.map((p) => {
        const rs = runs.filter((r) => r.period === p);
        return (
          <Card key={p} className="mb-4">
            <CardHeader><CardTitle>{p} · {formatMoney(rs.reduce((s, r) => s + r.feeCents, 0))}</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <caption className="sr-only">Fees for {p}</caption>
                <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Property</th><th scope="col" className="text-right">Basis</th><th scope="col" className="text-right">Fee</th><th scope="col" className="pl-4">Bill</th></tr></thead>
                <tbody>{rs.map((r) => (
                  <tr key={r.id} className="border-t border-border"><td className="py-2">{props.find((x) => x.id === r.propertyId)?.name}</td><td className="text-right tabular">{formatMoney(r.basisCents)}</td><td className="text-right tabular">{formatMoney(r.feeCents)}</td><td className="pl-4">{r.billId ? <Link className="text-primary hover:underline" href={`/app/accounting/bills/${r.billId}`}>View bill</Link> : <span className="text-muted-foreground">No fee</span>}</td></tr>
                ))}</tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
      {!periods.length ? <p className="text-sm text-muted-foreground">No fee runs yet.</p> : null}
    </>
  );
}
