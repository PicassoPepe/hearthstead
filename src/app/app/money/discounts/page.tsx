import Link from "next/link";
import { BadgePercent } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listLeases, orgToday } from "@/server/leasing/queries";
import { discountPolicy } from "@/server/discounts/service";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GiveDiscountButton } from "@/components/discounts/discount-form";
import { DiscountPolicyForm } from "@/components/discounts/discount-actions";
import { describeDiscount, DISCOUNT_STATUS_LABEL as STATUS_LABEL } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Discounts & concessions" };


export default async function DiscountsPage({ searchParams }: { searchParams: Promise<{ lease?: string }> }) {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "discounts", "view")) return <Forbidden what="discounts" />;
  const { lease } = await searchParams;
  const canGive = can(ctx.permissions, "discounts", "edit");
  const canApprove = can(ctx.permissions, "discounts", "delete");
  const scope = ctx.membership.propertyScope;
  const [discounts, policy, leases, properties, today] = await Promise.all([
    ctx.db.discount.findMany({
      where: scope.length ? { OR: [{ propertyId: { in: scope } }, { propertyId: null }] } : {},
      include: { applications: { select: { amountCents: true } }, redemptions: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    discountPolicy(ctx.db),
    canGive ? listLeases(ctx, { status: { in: ["ACTIVE", "EVICTION"] } }) : Promise.resolve([]),
    ctx.db.property.findMany({ where: scope.length ? { id: { in: scope } } : {}, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    orgToday(ctx),
  ]);
  const leaseRows = discounts.filter((d) => d.leaseId).map((d) => d.leaseId!);
  const leaseLabels = new Map((await ctx.db.lease.findMany({ where: { id: { in: leaseRows } }, include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } })).map((l) => [l.id, `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`]));
  const pending = discounts.filter((d) => d.status === "PENDING_APPROVAL");
  const given = discounts.reduce((s, d) => s + d.applications.reduce((t, x) => t + x.amountCents, 0), 0);

  return (
    <div className="grid gap-4">
      <PageHeader icon={<BadgePercent aria-hidden />} eyebrow="Rent & Money" title="Discounts & concessions"
        description="Take money off rent or fees for a tenant — a move-in special, a goodwill late-fee waiver, a repair inconvenience. Every discount needs a reason, shows on the tenant's account, and is kept in a history that can't be changed."
        actions={<>
          <Link href="/api/exports/discounts" className="text-sm font-medium text-primary hover:underline">Download for taxes (CSV)</Link>
          {canGive ? <GiveDiscountButton today={toISODate(today)} defaultLeaseId={lease} reasons={policy.reasons} leases={leases.map((l) => ({ id: l.id, label: `${l.label} — ${l.tenants}` }))} properties={properties.map((p) => ({ id: p.id, label: p.name }))} /> : null}
        </>} />
      <p className="text-sm text-muted-foreground">Discounts given so far: <span className="font-semibold text-foreground">{formatMoney(given)}</span>. They lower rent income in your reports (the “Concessions &amp; Discounts” line).</p>
      {pending.length ? (
        <Card>
          <CardHeader><CardTitle>Waiting for approval ({pending.length})</CardTitle></CardHeader>
          <CardContent><ul className="divide-y divide-border text-sm">{pending.map((d) => <li key={d.id} className="py-2"><Link className="font-medium text-primary hover:underline" href={`/app/money/discounts/${d.id}`}>{d.name}</Link> <span className="text-muted-foreground">— {describeDiscount(d)}</span></li>)}</ul></CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle>All discounts</CardTitle></CardHeader>
        <CardContent>
          {discounts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Discounts</caption>
                <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Discount</th><th scope="col">For</th><th scope="col">Status</th><th scope="col" className="text-right">Taken off</th></tr></thead>
                <tbody>
                  {discounts.map((d) => (
                    <tr key={d.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3"><Link href={`/app/money/discounts/${d.id}`} className="font-medium text-primary hover:underline">{d.name}</Link><div className="text-xs text-muted-foreground">{describeDiscount(d)}</div></td>
                      <td className="pr-3">{d.delivery === "CODE" ? <span>Code <code className="rounded bg-surface-muted px-1">{d.code}</code> · used {d.redemptions.length}{d.maxUses ? ` of ${d.maxUses}` : ""}</span> : leaseLabels.get(d.leaseId ?? "") ?? "—"}</td>
                      <td className="pr-3"><Badge tone={STATUS_LABEL[d.status]?.tone ?? "neutral"}>{STATUS_LABEL[d.status]?.text ?? d.status}</Badge></td>
                      <td className="text-right tabular">{formatMoney(d.applications.reduce((s, x) => s + x.amountCents, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">No discounts yet.{canGive ? " Press “Give a discount” to add one." : ""}</p>}
        </CardContent>
      </Card>
      {canApprove ? (
        <Card>
          <CardHeader><div><CardTitle>Discount settings</CardTitle><CardDescription>The reasons staff pick from, and when a second person has to approve.</CardDescription></div></CardHeader>
          <CardContent><DiscountPolicyForm reasons={policy.reasons} overCents={policy.overCents} overPercentBps={policy.overPercentBps} /></CardContent>
        </Card>
      ) : null}
    </div>
  );
}
