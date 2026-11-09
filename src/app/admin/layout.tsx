import Link from "next/link";
import { auth } from "@/server/auth";
import { signOutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export const metadata = { title: { default: "Owner console", template: "%s · Owner console · DeedWood" }, robots: { index: false } };

const NAV = [
  ["Overview", "/admin"],
  ["Companies", "/admin/orgs"],
  ["People", "/admin/users"],
  ["Feature switches", "/admin/flags"],
  ["Announcements", "/admin/announcements"],
  ["Releases", "/admin/releases"],
  ["Audit log", "/admin/audit"],
  ["System health", "/admin/health"],
] as const;

/** DeedWood's control plane. Each page checks access itself (requirePlatformPage). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await auth();
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.svg" alt="DeedWood" className="h-9 w-auto" />
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">Owner console</span>
          </Link>
          <nav aria-label="Owner console" className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([label, href]) => <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground">{label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-sidebar-muted">{s?.user?.email}</span>
            <form action={signOutAction}><Button size="sm" variant="ghost" type="submit" className="text-sidebar-foreground hover:bg-sidebar-hover">Sign out</Button></form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
