import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReleaseForm } from "@/components/admin/admin-forms";
import pkg from "../../../../package.json";

export const metadata = { title: "Releases" };

export default async function AdminReleases() {
  await requirePlatformPage();
  const list = await adminDb.release.findMany({ orderBy: { publishedAt: "desc" }, take: 50 });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Releases</h1>
      <p className="text-sm text-muted-foreground">This server runs version <strong>{pkg.version}</strong>. Publishing a release tells computer (local) installs that an update is available; a <em>minimum version</em> makes it a required update.</p>
      <Card><CardHeader><CardTitle>Publish a release</CardTitle></CardHeader><CardContent><ReleaseForm current={pkg.version} /></CardContent></Card>
      <ul className="grid gap-2">
        {list.map((r) => (
          <li key={r.id} className="rounded-card border border-border bg-surface p-3 text-sm shadow-card">
            <p className="font-medium">{r.version} <Badge>{r.channel}</Badge> {r.minVersion ? <Badge tone="warning">requires ≥ {r.minVersion}</Badge> : null} <span className="text-xs text-muted-foreground">{r.publishedAt.toISOString().slice(0, 10)}</span></p>
            <p className="whitespace-pre-wrap text-muted-foreground">{r.notes}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
