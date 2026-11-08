import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { PageHeader } from "@/components/patterns/page-header";
import { AvatarPicker } from "@/components/images/branding-images";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sessions, SupportAccess, TwoFactor } from "@/components/platform/security";

export const metadata = { title: "Security" };

const device = (ua: string | null) => {
  if (!ua) return "Unknown device";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /Headless/.test(ua) ? "Automated browser" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${b}${os ? ` on ${os}` : ""}`;
};

export default async function SecurityPage() {
  const ctx = await requireContext();
  const session = (await auth()) as { sid?: string } | null;
  const [user, sessions, org] = await Promise.all([
    adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } }),
    adminDb.userSession.findMany({ where: { userId: ctx.user.id, revokedAt: null }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    adminDb.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
  ]);
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader eyebrow="Settings" title="Account & security" description="Your profile photo, two-factor authentication, where you're signed in, and support access." />
      <Card>
        <CardHeader><div><CardTitle>Profile photo</CardTitle><CardDescription>{user.name} · {user.email}</CardDescription></div></CardHeader>
        <CardContent><AvatarPicker current={user.image} /></CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>Two-factor authentication</CardTitle><CardDescription>Protect your account with a code from an authenticator app (TOTP).</CardDescription></div></CardHeader>
        <CardContent><TwoFactor enabled={user.twoFactorEnabled} /></CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>Active sessions</CardTitle><CardDescription>Devices signed in to your account. Signing one out takes effect within a minute.</CardDescription></div></CardHeader>
        <CardContent><Sessions sessions={sessions.map((s) => ({ id: s.id, device: device(s.userAgent), ip: s.ip, lastSeen: s.lastSeenAt.toISOString(), current: s.id === session?.sid }))} /></CardContent>
      </Card>
      {can(ctx.permissions, "settings", "edit") ? (
        <Card>
          <CardHeader><div><CardTitle>Support access</CardTitle><CardDescription>For the whole workspace. Only admins can change this.</CardDescription></div></CardHeader>
          <CardContent><SupportAccess until={org.supportAccessUntil?.toISOString() ?? null} /></CardContent>
        </Card>
      ) : null}
    </div>
  );
}
