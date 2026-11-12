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
import { ChoosePlanButton, ManageBillingButton } from "@/components/settings/billing-buttons";
import { adminDb } from "@/server/db";
import { billingState, getSubscription } from "@/server/billing/subscription";
import { billingConfigured } from "@/server/billing/stripe-client";
import { BILLING_STATE_LABEL } from "@/lib/billing-labels";
import { DEFAULT_PLANS, hostedPlanFor, quote } from "@/lib/pricing";

export const metadata = { title: "Billing" };

/** Hosted companies: the subscription (trial, free beta, paid through Stripe), plan choices with prices, and usage. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="billing" />;
  if (isLocalInstall()) return <LocalBilling canEdit={can(ctx.permissions, "settings", "edit")} units={await ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } })} />;
  const { checkout } = await searchParams;
  const canEdit = can(ctx.permissions, "settings", "edit");
  const [units, sms, sub, planRows] = await Promise.all([
    ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } }),
    smsUsage(ctx.db),
    getSubscription(ctx.org.id),
    adminDb.plan.findMany({ where: { mode: "HOSTED", active: true }, orderBy: { sortOrder: "asc" } }).catch(() => []),
  ]);
  const plans = planRows.length ? planRows : DEFAULT_PLANS.filter((p) => p.mode === "HOSTED");
  const { state, daysLeft } = billingState(sub);
  const label = BILLING_STATE_LABEL[state];
  const ready = billingConfigured();
  const suggested = hostedPlanFor(units);
  const current = plans.find((p) => p.key === sub.planKey);
  const isComp = state === "comped";
  const summary: Record<string, string> = {
    comped: `Your company uses DeedWood for free${sub.compUntil && sub.compUntil > new Date() ? ` until ${fmtDate(sub.compUntil)}` : ""}. No card is needed.`,
    trial: `Your free trial has ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Choose a plan any time — nothing is charged until you do.`,
    trial_ended: "Your free trial has ended. Choose a plan to keep adding and changing things. Nothing has been deleted.",
    active: sub.cancelAtPeriodEnd && sub.currentPeriodEnd ? `Your plan ends on ${fmtDate(sub.currentPeriodEnd)} and won't renew.` : `You're on ${current?.displayName ?? "a paid plan"}${sub.currentPeriodEnd ? `. Next bill around ${fmtDate(sub.currentPeriodEnd)}` : ""}.`,
    past_due: `Your last payment didn't go through. Update your card within ${daysLeft} day${daysLeft === 1 ? "" : "s"} to stay fully active.`,
    read_only: "Payment is overdue, so the account is read-only. Update your card to turn everything back on. Nothing has been deleted.",
    canceled: "Your plan was canceled. Choose a plan to turn everything back on. Nothing has been deleted.",
  };
  const showPlans = !isComp && state !== "active" && state !== "past_due";
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader eyebrow="Settings" title="Billing" description="Your DeedWood plan and what you'd pay." />
      {checkout === "done" ? <p role="status" className="rounded-lg bg-success-soft p-3 text-sm text-success-soft-foreground">Thanks! Your payment went through. It can take a minute for your plan to show here.</p> : null}
      {checkout === "cancelled" ? <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm">Checkout was cancelled — nothing was charged.</p> : null}
      <Card>
        <CardHeader><div><CardTitle>Your plan <Badge tone={label.tone} className="ml-2" data-testid="billing-state">{label.text}</Badge></CardTitle><CardDescription>{summary[state]}</CardDescription></div></CardHeader>
        <CardContent className="grid gap-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Units</dt><dd className="tabular font-medium">{units}</dd></div>
            <div className="flex justify-between rounded-lg bg-surface-muted/60 p-3"><dt>Text messages this month</dt><dd className="tabular font-medium">{sms.used.toLocaleString()}</dd></div>
          </dl>
          {sub.stripeCustomerId && canEdit && ready ? <div><ManageBillingButton /></div> : null}
        </CardContent>
      </Card>
      {showPlans ? (
        <Card>
          <CardHeader><div><CardTitle>Choose a plan</CardTitle><CardDescription>Prices for your {units} unit{units === 1 ? "" : "s"}. Pay by card through Stripe; cancel any time. Have a promo code? Enter it on the payment page.</CardDescription></div></CardHeader>
          <CardContent className="grid gap-3">
            {plans.map((p) => {
              const fits = units >= p.unitMin && (p.unitMax == null || units <= p.unitMax);
              const m = quote(p, units, "month");
              const y = quote(p, units, "year");
              return (
                <div key={p.key} className={`grid gap-2 rounded-lg border p-3 sm:flex sm:items-center sm:justify-between ${p.key === suggested ? "border-primary" : "border-border"}`} data-plan={p.key}>
                  <div className="text-sm">
                    <p className="font-semibold">{p.displayName}{p.key === suggested ? <Badge tone="success" className="ml-2">Best fit</Badge> : null}</p>
                    <p className="text-muted-foreground">{p.description}</p>
                    <p className="tabular mt-1">{Number.isFinite(m) ? `${formatMoney(m)}/month` : ""}{Number.isFinite(m) && Number.isFinite(y) && SOLD_YEARLY.has(p.key) ? " · " : ""}{Number.isFinite(y) && SOLD_YEARLY.has(p.key) ? `${formatMoney(y)}/year` : ""}</p>
                    {!fits ? <p className="text-xs text-muted-foreground">Made for {p.unitMin}{p.unitMax ? `–${p.unitMax}` : "+"} units.</p> : null}
                  </div>
                  {canEdit && ready && fits ? (
                    <div className="flex flex-wrap gap-2">
                      <ChoosePlanButton planKey={p.key} interval="month" label="Pay monthly" primary={p.key === suggested} />
                      {SOLD_YEARLY.has(p.key) ? <ChoosePlanButton planKey={p.key} interval="year" label="Pay yearly" /> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!ready ? <p className="text-xs text-muted-foreground" data-testid="billing-not-ready">Online payment isn&apos;t switched on yet — nothing will be charged.</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Plans with a yearly Stripe price (Starter flat; Scale graduated per unit). */
const SOLD_YEARLY = new Set(["hosted_starter", "hosted_scale"]);

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

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
