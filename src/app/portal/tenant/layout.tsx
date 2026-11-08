import { OrgMark } from "@/components/patterns/org-mark";
import Link from "next/link";
import { Eye } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { accessibleBrand } from "@/server/portal/queries";
import { PortalNav } from "@/components/portal/portal-nav";
import { LeaseSwitcher } from "@/components/portal/lease-switcher";
import { exitPreview } from "@/server/actions/portal";
import { signOutAction } from "@/server/actions/auth";

export const metadata = { title: { default: "Resident portal", template: "%s · Resident portal" } };

/** Mobile-first tenant portal, branded with the organization's color (if it's accessible). */
export default async function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortal();
  const brand = accessibleBrand(ctx.org.brandColor);
  return (
    <div className="min-h-dvh pb-20 md:pb-0" style={{ ["--primary" as string]: brand, ["--ring" as string]: brand }}>
      {ctx.preview ? (
        <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground">
          <Eye className="size-4" aria-hidden /> Previewing as {ctx.tenant.name} — read-only
          <form action={exitPreview}><button className="font-semibold underline">Exit preview</button></form>
        </div>
      ) : null}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <OrgMark name={ctx.org.name} logoUrl={ctx.org.logoUrl} brand={brand} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold leading-tight">{ctx.org.name}</div>
            <div className="truncate text-sm text-muted-foreground">{ctx.lease?.label ?? "Resident portal"}</div>
          </div>
          {!ctx.preview ? (
            <form action={signOutAction}><button className="rounded-md px-2 py-1 text-sm text-muted-foreground underline-offset-4 hover:underline">Sign out</button></form>
          ) : null}
        </div>
        {ctx.leases.length > 1 ? <div className="mx-auto max-w-3xl px-4 pb-3"><LeaseSwitcher leases={ctx.leases} current={ctx.lease?.id ?? ""} /></div> : null}
        <PortalNav variant="top" />
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-center text-xs text-muted-foreground">
        Questions? {ctx.org.phone ? <>Call <a className="underline" href={`tel:${ctx.org.phone}`}>{ctx.org.phone}</a></> : null}
        {ctx.org.email ? <> · <a className="underline" href={`mailto:${ctx.org.email}`}>{ctx.org.email}</a></> : null}
        <div className="mt-1"><Link href="/portal/tenant/messages" className="underline">Message your manager</Link></div>
      </footer>
      <PortalNav variant="bottom" />
    </div>
  );
}
