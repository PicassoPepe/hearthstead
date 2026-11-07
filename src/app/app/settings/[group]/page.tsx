import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/settings/setting-row";
import { ProcessorCard } from "@/components/payments/processor-card";
import { getPaymentsProvider } from "@/adapters/payments";
import { settingsInGroup, SETTING_GROUP_LABELS, type SettingGroup } from "@/server/settings/registry";
import { getSettings } from "@/server/settings/service";
import { toRowData } from "@/server/settings/meta";

const GROUPS: Record<string, { group: SettingGroup; description: string }> = {
  "late-fees": { group: "lateFees", description: "Company-wide late-fee policy. Properties and leases can override any value." },
  "tenant-portal": { group: "tenantPortal", description: "What tenants can see and do in their portal." },
  payments: { group: "payments", description: "Fee pass-through and how payments are applied to open charges." },
  applications: { group: "applications", description: "Rental application fee and required sections." },
  notifications: { group: "notifications", description: "Automatic rent reminders sent to tenants." },
  "owner-portal": { group: "ownerPortal", description: "What owners can see in their portal." },
  communications: { group: "communications", description: "Text messaging, usage limits and portal message notifications." },
};

const LATER: Record<string, { title: string; phase: number; description: string }> = {
  integrations: { title: "Integrations", phase: 10, description: "API keys, webhooks, sandbox mode and QuickBooks export." },
  security: { title: "Security", phase: 10, description: "Two-factor authentication, active sessions, and a support-access toggle that expires in 30 days." },
  billing: { title: "Billing", phase: 10, description: "Your Hearthstead plan, invoices and SMS usage." },
};

export async function generateMetadata({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  const g = GROUPS[group];
  return { title: g ? SETTING_GROUP_LABELS[g.group] : (LATER[group]?.title ?? "Settings") };
}

export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group: slug } = await params;
  const later = LATER[slug];
  if (later) return <ComingSoon {...later} />;
  const g = GROUPS[slug];
  if (!g) notFound();

  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  const keys = settingsInGroup(g.group);
  const resolved = await getSettings(ctx.db, keys, { orgId: ctx.org.id });
  const rows = keys.map((k) => toRowData(resolved[k]));
  const canEdit = can(ctx.permissions, "settings", "edit");

  return (
    <div className="max-w-3xl">
      <PageHeader title={SETTING_GROUP_LABELS[g.group]} description={g.description} eyebrow="Settings" />
      {slug === "payments" ? (
        <ProcessorCard
          account={await ctx.db.processorAccount.findFirst().then((a) => (a ? { status: a.status, externalId: a.externalId, payoutBankMask: a.payoutBankMask } : null))}
          provider={getPaymentsProvider().name}
          canEdit={canEdit}
        />
      ) : null}
      <Card>
        <CardHeader className="pb-0">
          <div>
            <CardTitle>Company defaults</CardTitle>
            <CardDescription>Turn on “Customize” to change a value from the built-in default.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {rows.map((r) => (
            <SettingRow key={r.key} row={r} scope="ORG" canEdit={canEdit} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
