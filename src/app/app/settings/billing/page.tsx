import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { smsUsage } from "@/server/comms/service";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Billing" };

/** Plan + usage. Pricing is illustrative: $1.50/unit/month (min $49), 1,000 SMS segments included, then 2¢. */
const PER_UNIT = 150;
const MINIMUM = 4_900;
const SMS_INCLUDED = 1_000;
const SMS_OVERAGE = 2;

export default async function BillingPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="billing" />;
  const [units, sms, apiCalls] = await Promise.all([
    ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } }),
    smsUsage(ctx.db),
    ctx.db.apiKey.count({ where: { revokedAt: null } }),
  ]);
  const base = Math.max(MINIMUM, units * PER_UNIT);
  const smsOver = Math.max(0, sms.used - SMS_INCLUDED) * SMS_OVERAGE;
  const now = new Date();
  const invoices = [1, 2, 3].map((m) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1)); return { id: `INV-${d.toISOString().slice(0, 7).replace("-", "")}`, period: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), amount: base }; });
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader eyebrow="Settings" title="Billing" description="Your plan, this month's usage and invoices." />
      <Card>
        <CardHeader><div><CardTitle>Growth plan <Badge tone="success" className="ml-2">Active</Badge></CardTitle><CardDescription>{formatMoney(PER_UNIT)} per unit per month (minimum {formatMoney(MINIMUM)}). Includes the tenant & owner portals, online payments, AI features and the API.</CardDescription></div></CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Units</dt><dd className="tabular font-medium">{units} × {formatMoney(PER_UNIT)} = {formatMoney(units * PER_UNIT)}</dd></div>
            <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>SMS this month</dt><dd className="tabular font-medium">{sms.used.toLocaleString()} / {SMS_INCLUDED.toLocaleString()} included{smsOver ? ` · +${formatMoney(smsOver)}` : ""}</dd></div>
            <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Active API keys</dt><dd className="tabular font-medium">{apiCalls}</dd></div>
            <div className="flex justify-between rounded-lg bg-primary-soft p-3 text-primary-soft-foreground"><dt className="font-medium">Estimated next invoice</dt><dd className="tabular font-semibold">{formatMoney(base + smsOver)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Payment method: Visa ending 4242 (demo). Billing is handled by the platform&apos;s payment processor; nothing is charged in this demo.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm"><caption className="sr-only">Invoices</caption><thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Invoice</th><th scope="col">Period</th><th scope="col">Status</th><th scope="col" className="text-right">Amount</th></tr></thead>
            <tbody>{invoices.map((i) => <tr key={i.id} className="border-t border-border"><td className="py-2">{i.id}</td><td>{i.period}</td><td><Badge tone="success">Paid</Badge></td><td className="text-right tabular">{formatMoney(i.amount)}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
