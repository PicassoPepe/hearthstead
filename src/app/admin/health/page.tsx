import { requirePlatformPage } from "@/server/platform-admin/page";
import { healthChecks } from "@/server/platform-admin/health";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

export default async function AdminHealth() {
  await requirePlatformPage();
  const checks = await healthChecks();
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
    </div>
  );
}
