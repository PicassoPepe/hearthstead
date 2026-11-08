import { requireContext } from "@/server/context";
import { AppShell } from "@/components/shell/app-shell";
import { adminDb } from "@/server/db";

export default async function StaffLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const ctx = await requireContext();
  const [org, user, unread] = await Promise.all([
    adminDb.organization.findUnique({ where: { id: ctx.org.id }, select: { logoUrl: true } }),
    adminDb.user.findUnique({ where: { id: ctx.user.id }, select: { image: true } }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  return (
    <AppShell
      modal={modal}
      data={{
        user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
        org: { id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, sandbox: ctx.org.sandbox },
        orgs: ctx.orgs,
        roleName: ctx.membership.roleName,
        permissions: ctx.permissions,
        sidebarCollapsed: ctx.user.preferences.sidebarCollapsed === true,
        orgName: ctx.org.name,
        orgLogoUrl: org?.logoUrl ?? null,
        userImage: user?.image ?? null,
        unreadNotifications: unread,
      }}
    >
      {children}
    </AppShell>
  );
}
