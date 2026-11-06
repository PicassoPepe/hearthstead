import { getSettings } from "@/server/settings/service";
import { SETTINGS, SETTING_GROUP_LABELS, type Scope, type SettingGroup, type SettingKey } from "@/server/settings/registry";
import { toRowData } from "@/server/settings/meta";
import type { AppContext } from "@/server/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "./setting-row";

const GROUPS: SettingGroup[] = ["lateFees", "payments", "tenantPortal", "notifications", "applications", "ownerPortal"];

/** Settings overrides for one property or lease, grouped, with "Inherited from …" badges. */
export async function ScopedSettings({ ctx, scope, scopeId, propertyId, canEdit }: { ctx: AppContext; scope: Exclude<Scope, "ORG">; scopeId: string; propertyId?: string; canEdit: boolean }) {
  const keys = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].scopes.includes(scope) && GROUPS.includes(SETTINGS[k].group));
  const resolved = await getSettings(ctx.db, keys, scope === "PROPERTY" ? { orgId: ctx.org.id, propertyId: scopeId } : { orgId: ctx.org.id, propertyId, leaseId: scopeId });
  return (
    <div className="grid gap-4">
      {GROUPS.map((g) => {
        const rows = keys.filter((k) => SETTINGS[k].group === g).map((k) => toRowData(resolved[k]));
        if (!rows.length) return null;
        const overridden = rows.filter((r) => r.source === scope).length;
        return (
          <Card key={g}>
            <CardHeader className="pb-0">
              <div>
                <CardTitle as="h3">{SETTING_GROUP_LABELS[g]}</CardTitle>
                <CardDescription>{overridden ? `${overridden} override${overridden === 1 ? "" : "s"} for this ${scope.toLowerCase()}` : "Everything inherited"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {rows.map((r) => <SettingRow key={r.key} row={r} scope={scope} scopeId={scopeId} canEdit={canEdit} />)}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
