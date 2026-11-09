import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { licensePublicKey } from "@/lib/license-public-key";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAction } from "@/components/admin/admin-action";
import { IssueLicenseForm } from "@/components/admin/license-forms";
import { revokeLicenseAction } from "@/server/actions/admin";

export const metadata = { title: "Licenses" };

export default async function AdminLicenses() {
  await requirePlatformPage();
  const [list, plans] = await Promise.all([
    adminDb.license.findMany({ orderBy: { issuedAt: "desc" }, take: 200 }),
    adminDb.plan.findMany({ where: { mode: "SELF_HOSTED" }, orderBy: { sortOrder: "asc" }, select: { key: true, displayName: true } }),
  ]);
  const ready = Boolean(licensePublicKey() && process.env.LICENSE_SIGNING_PRIVATE_KEY);
  const now = new Date();
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Licenses (computer installs)</h1>
      {!ready ? (
        <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          Licensing isn&apos;t switched on yet. On your computer run <code>pnpm license:keygen</code>, commit the public key it writes, and paste the private key it prints into your host&apos;s settings as <code>LICENSE_SIGNING_PRIVATE_KEY</code>. Until then, computer installs aren&apos;t limited.
        </p>
      ) : null}
      <Card><CardHeader><CardTitle>Issue a license</CardTitle></CardHeader><CardContent><IssueLicenseForm plans={plans} disabled={!ready} /></CardContent></Card>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Licenses</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Customer", "Plan", "Units", "Good until", "Last check-in", "Status", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-3 py-2">{l.customerName ?? "—"}<div className="text-xs text-muted-foreground">{l.customerEmail}</div></td>
                <td className="px-3 py-2">{l.planKey}</td>
                <td className="px-3 py-2 tabular">{l.lastCheckInUnits ?? "?"} / {l.maxUnits}</td>
                <td className="px-3 py-2">{l.validUntil.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">{l.lastCheckInAt ? `${l.lastCheckInAt.toISOString().slice(0, 10)} · v${l.lastCheckInVersion}` : "never"}</td>
                <td className="px-3 py-2">{l.status === "REVOKED" ? <Badge tone="danger">Turned off</Badge> : l.validUntil < now ? <Badge tone="warning">Ended</Badge> : <Badge tone="success">Active</Badge>}</td>
                <td className="px-3 py-2">{l.status !== "REVOKED" ? <AdminAction label="Turn off" danger needsCode description="Use for a refund, chargeback or a leaked license. The install becomes read-only at its next daily check-in." action={revokeLicenseAction.bind(null, l.id)} /> : null}</td>
              </tr>
            ))}
            {!list.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No licenses yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
