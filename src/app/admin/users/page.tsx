import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminAction } from "@/components/admin/admin-action";
import { resetUserMfaAction, revokeUserSessionsAction } from "@/server/actions/admin";

export const metadata = { title: "People" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePlatformPage();
  const q = (await searchParams).q?.trim() ?? "";
  const users = q
    ? await adminDb.user.findMany({
        where: { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
        take: 50,
        orderBy: { email: "asc" },
        include: { memberships: { where: { deletedAt: null }, include: { organization: { select: { name: true } } } } },
      })
    : [];
  const live = await adminDb.userSession.groupBy({ by: ["userId"], where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, _count: true });
  const devices = new Map(live.map((l) => [l.userId, l._count]));
  const admins = new Set((await adminDb.platformAdmin.findMany({ select: { userId: true } })).map((a) => a.userId));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">People</h1>
      <form className="flex max-w-md gap-2"><Input name="q" defaultValue={q} placeholder="Find by email or name" aria-label="Find a person" /><Button type="submit">Find</Button></form>
      {q && !users.length ? <p className="text-sm text-muted-foreground">No one matches “{q}”.</p> : null}
      <ul className="grid gap-2">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 shadow-card">
            <div className="text-sm">
              <p className="font-medium">{u.name ?? "—"} <span className="text-muted-foreground">{u.email}</span> {admins.has(u.id) ? <Badge tone="warning">Platform owner</Badge> : null} {u.deletedAt ? <Badge tone="danger">Deleted</Badge> : null}</p>
              <p className="text-xs text-muted-foreground">{u.memberships.map((m) => m.organization.name).join(", ") || "No company"} · two-factor {u.twoFactorEnabled ? "on" : "off"} · {devices.get(u.id) ?? 0} signed-in device{devices.get(u.id) === 1 ? "" : "s"}</p>
            </div>
            <div className="flex gap-2">
              <AdminAction label="Sign out everywhere" action={revokeUserSessionsAction.bind(null, u.id)} />
              {u.twoFactorEnabled && u.id !== p.userId ? <AdminAction label="Reset two-factor" danger needsCode description="Use this when someone lost their phone. They'll be signed out and asked to set two-factor up again." action={resetUserMfaAction.bind(null, u.id)} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
