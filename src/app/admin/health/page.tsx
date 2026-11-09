import { requirePlatformPage } from "@/server/platform-admin/page";
import { healthChecks } from "@/server/platform-admin/health";
import { Badge } from "@/components/ui/badge";
import { adminDb } from "@/server/db";
import { backupRuns } from "@/server/ops/backup-list";
import { BackupPanel } from "@/components/admin/backup-panel";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

export default async function AdminHealth() {
  await requirePlatformPage();
  const [checks, runs, errors] = await Promise.all([
    healthChecks(),
    backupRuns(),
    adminDb.errorEvent.groupBy({ by: ["fingerprint"], where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 30 }),
  ]);
  const samples = await adminDb.errorEvent.findMany({ where: { fingerprint: { in: errors.map((e) => e.fingerprint) } }, orderBy: { createdAt: "desc" }, distinct: ["fingerprint"] });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">System health</h1>
      <ul className="grid gap-2">
        {checks.map((c) => (
          <li key={c.name} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-3 text-sm shadow-card" data-testid="health-check">
            <span className="font-medium">{c.name}</span>
            <span className="flex items-center gap-2"><span className="text-muted-foreground">{c.detail}</span><Badge tone={c.status === "ok" ? "success" : c.status === "down" ? "danger" : "neutral"}>{c.status === "ok" ? "OK" : c.status === "down" ? "Problem" : "Off"}</Badge></span>
          </li>
        ))}
      </ul>
      <h2 className="mt-4 text-xl font-semibold">Backups</h2>
      <p className="text-sm text-muted-foreground">The whole database is backed up every night; the newest 14 are kept. To put one back: <code>pnpm db:restore --latest --yes</code> (see docs/LAUNCH.md).</p>
      <BackupPanel runs={runs} />
      <h2 className="mt-4 text-xl font-semibold">Errors in the last 7 days</h2>
      {errors.length ? (
        <ul className="grid gap-2" data-testid="error-list">
          {errors.map((e) => {
            const s = samples.find((x) => x.fingerprint === e.fingerprint);
            return (
              <li key={e.fingerprint} className="rounded-card border border-border bg-surface p-3 text-sm">
                <p className="font-medium">{s?.message} <Badge tone="danger">{e._count}×</Badge></p>
                <p className="text-xs text-muted-foreground">{s?.source}{s?.path ? ` · ${s.path}` : ""} · last {e._max.createdAt?.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
                {s?.stack ? <details className="mt-1"><summary className="cursor-pointer text-xs">Details</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">{s.stack}</pre></details> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No errors. 🎉</p>}
    </div>
  );
}
