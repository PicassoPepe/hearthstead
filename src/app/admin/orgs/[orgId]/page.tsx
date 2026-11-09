import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { FLAGS, flagEnabled } from "@/server/platform-admin/service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAction } from "@/components/admin/admin-action";
import { ViewAsButton, FlagSwitch, CompButton } from "@/components/admin/admin-widgets";
import { compOrgAction, endCompOrgAction, forceLogoutOrgAction, reinstateOrgAction, suspendOrgAction } from "@/server/actions/admin";
import { billingState, getSubscription } from "@/server/billing/subscription";
import { BILLING_STATE_LABEL } from "@/lib/billing-labels";

export const metadata = { title: "Company" };

export default async function AdminOrg({ params }: { params: Promise<{ orgId: string }> }) {
  await requirePlatformPage();
  const { orgId } = await params;
  const org = await adminDb.organization.findUnique({ where: { id: orgId } });
  if (!org) notFound();
  const sub = await getSubscription(orgId);
  const bs = billingState(sub);
  const isComp = sub.status === "COMPLIMENTARY" || sub.status === "BETA";
  const [members, units, properties, tenants, flagRows] = await Promise.all([
    adminDb.membership.findMany({ where: { organizationId: orgId, deletedAt: null }, include: { user: { select: { id: true, email: true, name: true, twoFactorEnabled: true } }, role: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    adminDb.unit.count({ where: { organizationId: orgId, deletedAt: null } }),
    adminDb.property.count({ where: { organizationId: orgId, deletedAt: null } }),
    adminDb.tenant.count({ where: { organizationId: orgId, deletedAt: null } }),
    Promise.all(Object.keys(FLAGS).map(async (k) => ({ key: k, label: FLAGS[k]!.label, on: await flagEnabled(k, orgId), override: await adminDb.featureFlag.findFirst({ where: { key: k, orgId } }) }))),
  ]);
  return (
    <div className="grid gap-4">
      <p className="text-sm"><Link href="/admin/orgs" className="text-primary hover:underline">← Companies</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{org.name}</h1>
        {org.suspendedAt ? <Badge tone="danger">Paused</Badge> : <Badge tone="success">Active</Badge>}
      </div>
      {org.suspendedAt ? <p role="status" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground">Paused on {org.suspendedAt.toISOString().slice(0, 10)}: {org.suspendedReason}</p> : null}
      <div className="flex flex-wrap gap-2">
        {org.suspendedAt
          ? <AdminAction label="Turn back on" action={reinstateOrgAction.bind(null, org.id)} />
          : <AdminAction label="Pause this company" danger needsCode description="Staff won't be able to use the app until you turn it back on. Nothing is deleted." action={suspendOrgAction.bind(null, org.id)} />}
        <AdminAction label="Sign everyone out" description="Signs every staff member out of every device." action={forceLogoutOrgAction.bind(null, org.id)} />
      </div>
      <Card>
        <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p data-testid="admin-billing-state"><Badge tone={BILLING_STATE_LABEL[bs.state].tone}>{BILLING_STATE_LABEL[bs.state].text}</Badge>{" "}
            <span className="text-muted-foreground">
              {isComp ? `${sub.status === "BETA" ? "Beta tester" : "Complimentary"} — ${sub.compReason ?? ""}${sub.compUntil ? ` (until ${sub.compUntil.toISOString().slice(0, 10)})` : " (no end date)"}` : `Plan: ${sub.planKey} · ${sub.interval}ly${sub.stripeSubscriptionId ? " · paid through Stripe" : ""}`}
              {bs.daysLeft != null && !isComp ? ` · ${bs.daysLeft} day${bs.daysLeft === 1 ? "" : "s"} left` : ""}
            </span></p>
          <div className="flex flex-wrap gap-2">
            {isComp
              ? <AdminAction label="End free plan" description="They get a 14-day trial to choose a plan. Nothing is deleted." action={endCompOrgAction.bind(null, org.id)} />
              : <CompButton orgId={org.id} action={compOrgAction} />}
          </div>
        </CardContent>
      </Card>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[["Web name", org.slug], ["Properties", properties], ["Units", units], ["Tenants", tenants], ["Email", org.email ?? "—"], ["Phone", org.phone ?? "—"], ["State", org.state ?? "—"], ["Started", org.createdAt.toISOString().slice(0, 10)]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-border bg-surface p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
      <Card>
        <CardHeader><CardTitle>Staff</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{m.user.name ?? m.user.email}</span> <span className="text-muted-foreground">{m.user.email} · {m.role.name} · {m.status.toLowerCase()}{m.user.twoFactorEnabled ? " · 2FA on" : ""}</span></span>
                {m.status === "ACTIVE" ? <ViewAsButton orgId={org.id} userId={m.user.id} name={m.user.name ?? m.user.email} /> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Feature switches for this company</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {flagRows.map((f) => <FlagSwitch key={f.key} flagKey={f.key} label={f.label} orgId={org.id} on={f.on} overridden={Boolean(f.override)} />)}
        </CardContent>
      </Card>
    </div>
  );
}
