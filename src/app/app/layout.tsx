import { mustChangePasswordBlocks } from "@/lib/must-change-password";
import { requireContext } from "@/server/context";
import { ChangePasswordScreen } from "@/components/auth/change-password-screen";
import { AppShell } from "@/components/shell/app-shell";
import { adminDb } from "@/server/db";
import { activeAnnouncements } from "@/server/platform-admin/service";
import { ImpersonationBanner, PlatformNotice } from "@/components/shell/platform-banners";
import { LicenseBanner } from "@/components/shell/license-banner";
import { VerifyEmailBanner } from "@/components/shell/verify-email-banner";
import { localLicense } from "@/server/license/local";
import { hostedBillingNotice } from "@/server/billing/subscription";

/** Private pages: never in search results (robots.txt and the X-Robots-Tag header say so too). */
export const metadata = { robots: { index: false, follow: false } };

export default async function StaffLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const ctx = await requireContext();
  if (mustChangePasswordBlocks(ctx.user, Boolean(ctx.impersonation))) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <ChangePasswordScreen />
      </div>
    );
  }
  const lic = localLicense();
  const [org, user, unread, notices] = await Promise.all([
    adminDb.organization.findUnique({ where: { id: ctx.org.id }, select: { logoUrl: true } }),
    adminDb.user.findUnique({ where: { id: ctx.user.id }, select: { image: true, emailVerified: true } }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    activeAnnouncements(ctx.org.id),
  ]);
  const billing = await hostedBillingNotice(ctx.org.id);
  return (
    <AppShell
      modal={modal}
      banners={<>
        {lic.message || lic.updateRequired ? <LicenseBanner message={lic.message} readOnly={lic.readOnly} update={lic.updateRequired ? `A required update to DeedWood ${lic.latestVersion ?? ""} is ready — double-click "Update DeedWood".` : null} /> : null}
        {billing ? <LicenseBanner message={billing.message} readOnly={billing.readOnly} /> : null}
        {user && !user.emailVerified && !ctx.impersonation ? <VerifyEmailBanner email={ctx.user.email} /> : null}
        {ctx.impersonation ? <ImpersonationBanner name={ctx.user.name ?? ctx.user.email} org={ctx.org.name} expiresAt={ctx.impersonation.expiresAt} reason={ctx.impersonation.reason} /> : null}
        {notices.map((n) => <PlatformNotice key={n.id} id={n.id} title={n.title} body={n.body} level={n.level as "INFO" | "WARNING"} />)}
      </>}
      data={{
        user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
        org: { id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug, sandbox: ctx.org.sandbox },
        orgs: ctx.orgs,
        roleName: ctx.membership.roleName,
        roleKey: ctx.membership.roleKey ?? null,
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
