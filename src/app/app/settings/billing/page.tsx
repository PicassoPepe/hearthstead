import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { smsUsage } from "@/server/comms/service";
import { formatMoney } from "@/lib/money";
import { isLocalInstall, localLicense, readCheckInState } from "@/server/license/local";
import { InstallLicense } from "@/components/settings/license-panel";

export const metadata = { title: "Billing" };

/** Plan + usage. Pricing is illustrative: $1.50/unit/month (min $49), 1,000 SMS segments included, then 2¢. */
const PER_UNIT = 150;
const MINIMUM = 4_900;
const SMS_INCLUDED = 1_000;
const SMS_OVERAGE = 2;

export default async function BillingPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="billing" />;
  if (isLocalInstall()) return <LocalBilling canEdit={can(ctx.permissions, "settings", "edit")} units={await ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } })} />;
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

/** Computer installs: the license instead of a subscription. */
function LocalBilling({ canEdit, units }: { canEdit: boolean; units: number }) {
  const lic = localLicense();
  const ci = readCheckInState();
  const c = lic.claims;
  const label: Record<string, [string, "success" | "warning" | "danger" | "neutral"]> = {
    not_enforced: ["No license needed in this version", "neutral"], trial: ["Free trial", "warning"], trial_over: ["Trial ended — read-only", "danger"], valid: ["Active", "success"],
    grace: ["Ended — grace period", "warning"], expired: ["Ended — read-only", "danger"], invalid: ["Not valid — read-only", "danger"], revoked: ["Turned off — read-only", "danger"], hosted: ["", "neutral"],
  };
  const [text, tone] = label[lic.state] ?? ["", "neutral"];
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader eyebrow="Settings" title="Billing & license" description="DeedWood is installed on your own computer. Your yearly license covers updates and support." />
      <Card>
        <CardHeader><div><CardTitle>Your license <Badge tone={tone} className="ml-2">{text}</Badge></CardTitle><CardDescription>{lic.message || (c ? "Everything is in order." : "")}</CardDescription></div></CardHeader>
        <CardContent>
          {c ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Licensed to</dt><dd className="font-medium">{c.customer}</dd></div>
              <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Good until</dt><dd className="font-medium">{c.validUntil.slice(0, 10)}</dd></div>
              <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Units</dt><dd className="tabular font-medium">{units} of {c.maxUnits}</dd></div>
              <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Last checked with DeedWood</dt><dd className="font-medium">{ci.lastCheckInAt ? ci.lastCheckInAt.slice(0, 10) : "not yet"}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted-foreground">{lic.state === "not_enforced" ? "This copy of DeedWood doesn't need a license." : `You have ${units} unit${units === 1 ? "" : "s"}. Buy a license from DeedWood, then paste it below.`}</p>}
        </CardContent>
      </Card>
      {canEdit && lic.state !== "not_enforced" ? <Card><CardHeader><CardTitle>{c ? "Replace your license" : "Add your license"}</CardTitle></CardHeader><CardContent><InstallLicense /></CardContent></Card> : null}
    </div>
  );
}
