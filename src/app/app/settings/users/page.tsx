import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can, parsePermissions } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { MembersTable, type MemberRow } from "@/components/settings/members-table";
import { RolesEditor, type RoleRow } from "@/components/settings/roles-editor";

export const metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "users", "view")) return <Forbidden what="users and roles" />;
  const [members, roles] = await Promise.all([
    ctx.db.membership.findMany({ include: { user: true, role: true }, orderBy: { createdAt: "asc" } }),
    ctx.db.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { memberships: { where: { deletedAt: null } } } } } }),
  ]);
  const rows: MemberRow[] = members.map((m) => ({
    id: m.id,
    name: m.user.name ?? m.user.email,
    email: m.user.email,
    roleId: m.roleId,
    roleName: m.role.name,
    status: m.status,
    isSelf: m.userId === ctx.user.id,
    invitedAt: m.invitedAt?.toISOString() ?? null,
  }));
  const roleRows: RoleRow[] = roles.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem,
    permissions: parsePermissions(r.permissions), memberCount: r._count.memberships,
  }));
  const canEdit = can(ctx.permissions, "users", "edit");

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Users & roles"
        description="Invite teammates and control what each role can see and do."
        actions={canEdit ? <Button asChild><Link href="/app/new/user" scroll={false}><UserPlus aria-hidden /> Invite user</Link></Button> : null}
      />
      <section aria-labelledby="members-h" className="mb-8">
        <h2 id="members-h" className="mb-3 text-[15px] font-semibold">Team members</h2>
        <MembersTable rows={rows} roles={roles.map((r) => ({ id: r.id, name: r.name }))} canEdit={canEdit} canDelete={can(ctx.permissions, "users", "delete")} />
      </section>
      <section aria-labelledby="roles-h">
        <h2 id="roles-h" className="mb-1 text-[15px] font-semibold">Roles & permissions</h2>
        <p className="mb-3 text-sm text-muted-foreground">Built-in roles cover most teams. Create a custom role for anything else. Property scoping per member arrives with properties in Phase 2.</p>
        <RolesEditor roles={roleRows} canEdit={canEdit} />
      </section>
    </>
  );
}
