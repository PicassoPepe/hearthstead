import Link from "next/link";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { StatCard } from "@/components/patterns/stat-card";
import { healthChecks } from "@/server/platform-admin/health";

export const metadata = { title: "Overview" };

export default async function AdminHome() {
  await requirePlatformPage();
  const since = new Date(Date.now() - 86_400_000);
  const [orgs, suspended, users, units, failedLogins, activeImp, health] = await Promise.all([
    adminDb.organization.count({ where: { deletedAt: null, isSandbox: false } }),
    adminDb.organization.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
    adminDb.user.count({ where: { deletedAt: null } }),
    adminDb.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } }),
    adminDb.securityEvent.count({ where: { kind: "LOGIN_FAILED", createdAt: { gte: since } } }),
    adminDb.impersonation.count({ where: { endedAt: null, expiresAt: { gt: new Date() } } }),
    healthChecks(),
  ]);
  const bad = health.filter((h) => h.status === "down");
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">Owner console</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Companies" value={orgs} hint={suspended ? `${suspended} paused` : "None paused"} href="/admin/orgs" />
        <StatCard label="People with a login" value={users} href="/admin/users" />
        <StatCard label="Units managed" value={units} />
        <StatCard label="Failed sign-ins (24 h)" value={failedLogins} href="/admin/audit?tab=security" />
        <StatCard label="Active “view as” sessions" value={activeImp} href="/admin/audit" />
        <StatCard label="System health" value={bad.length ? `${bad.length} problem${bad.length === 1 ? "" : "s"}` : "All good"} href="/admin/health" />
      </div>
      <p className="text-sm text-muted-foreground">Every change you make here is written to the <Link className="text-primary underline" href="/admin/audit">audit log</Link> with your reason.</p>
    </div>
  );
}
