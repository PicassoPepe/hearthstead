import { redirect } from "next/navigation";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { TwoFactor } from "@/components/platform/security";
import { PasswordForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Turn on two-factor" };

/** The owner console requires two-factor authentication. This is the only page that works without it. */
export default async function AdminSetupPage() {
  const p = await requirePlatformPage({ allowNoMfa: true });
  const u = await adminDb.user.findUniqueOrThrow({ where: { id: p.userId }, select: { twoFactorEnabled: true, passwordHash: true } });
  if (u.twoFactorEnabled) redirect("/admin");
  if (!u.passwordHash) {
    return (
      <div className="mx-auto grid max-w-xl gap-4">
        <h1 className="text-2xl font-bold">Step 1 of 2: choose a password</h1>
        <p className="text-muted-foreground">The owner console signs in with a password plus a code from your phone. Start with the password.</p>
        <div className="rounded-card border border-border bg-surface p-4 shadow-card"><PasswordForm hasPassword={false} /></div>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <h1 className="text-2xl font-bold">Step 2 of 2: turn on two-factor authentication</h1>
      <p className="text-muted-foreground">The owner console controls every company on DeedWood, so it always needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) in addition to your password.</p>
      <div className="rounded-card border border-border bg-surface p-4 shadow-card"><TwoFactor enabled={false} /></div>
      <p className="text-sm text-muted-foreground">When it&apos;s on, sign out and sign back in with your password and a code, then open <strong>/admin</strong> again.</p>
    </div>
  );
}
