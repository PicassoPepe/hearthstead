import Link from "next/link";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { FLAGS, flagEnabled } from "@/server/platform-admin/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlagSwitch, NewFlagOverride } from "@/components/admin/admin-widgets";

export const metadata = { title: "Feature switches" };

export default async function AdminFlags() {
  await requirePlatformPage();
  const rows = await adminDb.featureFlag.findMany({ orderBy: [{ key: "asc" }, { orgId: "asc" }] });
  const keys = [...new Set([...Object.keys(FLAGS), ...rows.map((r) => r.key)])];
  const orgIds = [...new Set(rows.map((r) => r.orgId).filter((x): x is string => Boolean(x)))];
  const orgs = new Map((await adminDb.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
  const global = await Promise.all(keys.map(async (k) => ({ key: k, label: FLAGS[k]?.label ?? k, on: await flagEnabled(k, null), overridden: rows.some((r) => r.key === k && !r.orgId) })));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Feature switches</h1>
      <p className="text-sm text-muted-foreground">Turn features on or off for everyone, or for one company (a company setting wins over the everyone setting).</p>
      <Card><CardHeader><CardTitle>For everyone</CardTitle></CardHeader><CardContent className="grid gap-2">{global.map((f) => <FlagSwitch key={f.key} flagKey={f.key} label={f.label} orgId={null} on={f.on} overridden={f.overridden} />)}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Set for one company</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid gap-1 text-sm">
            {rows.filter((r) => r.orgId).map((r) => <li key={r.id}><Link className="text-primary hover:underline" href={`/admin/orgs/${r.orgId}`}>{orgs.get(r.orgId!) ?? r.orgId}</Link>: {FLAGS[r.key]?.label ?? r.key} is <strong>{r.enabled ? "on" : "off"}</strong></li>)}
            {!rows.some((r) => r.orgId) ? <li className="text-muted-foreground">No company-specific switches yet. You can also set them from a company&apos;s page.</li> : null}
          </ul>
          <NewFlagOverride flags={keys.map((k) => ({ key: k, label: FLAGS[k]?.label ?? k }))} />
        </CardContent>
      </Card>
    </div>
  );
}
