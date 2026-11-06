import { requireContext } from "@/server/context";
import { AppShell } from "@/components/shell/app-shell";

export default async function StaffLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const ctx = await requireContext();
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
      }}
    >
      {children}
    </AppShell>
  );
}
