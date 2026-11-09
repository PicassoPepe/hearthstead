import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { adminDb } from "@/server/db";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DiscountActions } from "@/components/discounts/discount-actions";
import { describeDiscount, DISCOUNT_STATUS_LABEL as STATUS_LABEL } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Discount" };

const ACTION_LABEL: Record<string, string> = { created: "Created", approved: "Approved", rejected: "Turned down", redeemed: "Code used", applied: "Taken off a charge", revoked: "Stopped" };

export default async function DiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "discounts", "view")) return <Forbidden what="discounts" />;
  const { id } = await params;
  const d = await ctx.db.discount.findFirst({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } }, applications: { orderBy: { createdAt: "asc" } }, redemptions: true } });
  if (!d || (d.propertyId && !canAccessProperty(ctx.membership.propertyScope, d.propertyId))) notFound();
  const userIds = [...new Set([...d.events.map((e) => e.actorId), d.createdById, d.approvedById].filter(Boolean) as string[])];
  const people = new Map((await adminDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const leaseIds = [...new Set([d.leaseId, ...d.applications.map((a) => a.leaseId), ...d.redemptions.map((r) => r.leaseId)].filter(Boolean) as string[])];
  const leases = new Map((await ctx.db.lease.findMany({ where: { id: { in: leaseIds } }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } })).map((l) => [l.id, `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`]));
  const charges = new Map((await ctx.db.leaseTransaction.findMany({ where: { id: { in: d.applications.map((a) => a.chargeId) } }, select: { id: true, memo: true, date: true } })).map((c) => [c.id, c]));
  const status = STATUS_LABEL[d.status] ?? { text: d.status, tone: "neutral" as const };
  const total = d.applications.reduce((s, a) => s + a.amountCents, 0);
  return (
    <div className="grid max-w-4xl gap-4">
      <p className="text-sm"><Link href="/app/money/discounts" className="text-primary hover:underline">← Discounts</Link></p>
      <PageHeader eyebrow="Discount" title={d.name} description={describeDiscount(d)} actions={<DiscountActions id={d.id} status={d.status} canApprove={can(ctx.permissions, "discounts", "delete")} isCreator={d.createdById === ctx.user.id} />} />
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["Status", <Badge key="s" tone={status.tone} data-testid="discount-status">{status.text}</Badge>],
          ["Reason", d.reasonText],
          ["Taken off so far", formatMoney(total)],
          ["For", d.delivery === "CODE" ? `Code ${d.code}${d.propertyId ? "" : " (any property)"}` : leases.get(d.leaseId ?? "") ?? "—"],
          ["Created by", people.get(d.createdById ?? "") ?? "—"],
          ["Approved by", d.approvedById ? people.get(d.approvedById) ?? "—" : "—"],
        ].map(([k, v]) => <div key={String(k)} className="rounded-lg border border-border bg-surface p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
      </dl>
      {d.revokeReason ? <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm">{d.status === "REJECTED" ? "Turned down" : "Stopped"}: {d.revokeReason}</p> : null}
      {d.notes ? <p className="text-sm"><span className="text-muted-foreground">Staff notes:</span> {d.notes}</p> : null}
      <Card>
        <CardHeader><CardTitle>Charges it came off</CardTitle></CardHeader>
        <CardContent>
          {d.applications.length ? (
            <table className="w-full text-sm"><caption className="sr-only">Charges discounted</caption>
              <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Charge</th><th scope="col">Lease</th><th scope="col" className="text-right">Before</th><th scope="col" className="text-right">Discount</th><th scope="col" className="text-right">After</th></tr></thead>
              <tbody>{d.applications.map((a) => {
                const c = charges.get(a.chargeId);
                return <tr key={a.id} className="border-t border-border"><td className="py-2">{c ? `${c.date.toISOString().slice(0, 10)} · ${c.memo ?? "Charge"}` : "—"}</td><td><Link className="text-primary hover:underline" href={`/app/leasing/${a.leaseId}?tab=transactions`}>{leases.get(a.leaseId) ?? "Lease"}</Link></td><td className="text-right tabular">{formatMoney(a.chargeCents)}</td><td className="text-right tabular">−{formatMoney(a.amountCents)}</td><td className="text-right tabular">{formatMoney(a.afterCents)}</td></tr>;
              })}</tbody>
            </table>
          ) : <p className="text-sm text-muted-foreground">Nothing yet.{d.status === "ACTIVE" ? " It comes off matching charges as they're posted." : ""}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm" data-testid="discount-history">
            {d.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 border-l-2 border-border pl-3">
                <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="text-muted-foreground">{e.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {people.get(e.actorId ?? "") ?? "System"}{e.ip ? ` · ${e.ip}` : ""}</span>
                {e.reason ? <span className="w-full text-muted-foreground">“{e.reason}”</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">This history can&apos;t be edited or deleted.</p>
        </CardContent>
      </Card>
    </div>
  );
}
