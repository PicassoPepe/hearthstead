import { requireOwnerPortal } from "@/server/portal/owner-context";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Distributions" };

export default async function OwnerPayments() {
  const o = await requireOwnerPortal();
  const rows = await o.db.ownerDistribution.findMany({ where: { ownerId: o.owner.id, propertyId: { in: o.propertyIds } }, orderBy: { date: "desc" }, take: 200 });
  const year = o.today.getUTCFullYear();
  const ytd = rows.filter((r) => r.kind === "DISTRIBUTION" && r.date.getUTCFullYear() === year).reduce((s, r) => s + r.amountCents, 0);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Distributions</h1>
      <Card className="p-4"><div className="text-sm text-muted-foreground">Paid to you in {year}</div><div className="text-3xl font-semibold tabular">{formatMoney(ytd)}</div></Card>
      <Card className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <div><div className="font-medium">{o.properties.find((p) => p.id === r.propertyId)?.name}</div><div className="text-muted-foreground">{formatDate(r.date)} · {r.kind === "DISTRIBUTION" ? `Distribution by ${r.method.toLowerCase()}` : "Your contribution"}</div></div>
            <span className="tabular font-semibold">{r.kind === "CONTRIBUTION" ? "+" : ""}{formatMoney(r.amountCents)}</span>
          </div>
        ))}
        {!rows.length ? <p className="p-6 text-center text-sm text-muted-foreground">No distributions yet.</p> : null}
      </Card>
    </div>
  );
}
