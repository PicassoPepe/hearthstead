import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/settings/setting-row";
import { AutoAssignRules } from "@/components/settings/auto-assign-rules";
import { getSettings } from "@/server/settings/service";
import { toRowData } from "@/server/settings/meta";
import { taskFormOptions } from "@/server/maintenance/queries";

export const metadata = { title: "Maintenance settings" };

export default async function MaintenanceSettings() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  const [s, opts] = await Promise.all([getSettings(ctx.db, ["maintenance.autoAssignRules", "maintenance.notifyTenantOnUpdate"], { orgId: ctx.org.id }), taskFormOptions(ctx)]);
  const canEdit = can(ctx.permissions, "settings", "edit");
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Settings" title="Maintenance" description="How tenant requests and work orders are routed." />
      <Card className="mb-4">
        <CardHeader>
          <div>
            <CardTitle>Auto-assign rules</CardTitle>
            <CardDescription>When a request comes in (portal or staff), assign it by category. Properties can override these from their Settings tab in a later phase.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <AutoAssignRules initial={s["maintenance.autoAssignRules"].value} members={opts.members} vendors={opts.vendors} canEdit={canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-2">
          <SettingRow row={toRowData(s["maintenance.notifyTenantOnUpdate"])} scope="ORG" canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
