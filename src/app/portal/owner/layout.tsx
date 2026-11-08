import { OrgMark } from "@/components/patterns/org-mark";
import { requireOwnerPortal } from "@/server/portal/owner-context";
import { accessibleBrand } from "@/server/portal/queries";
import { OwnerNav } from "@/components/owner-portal/owner-nav";
import { signOutAction } from "@/server/actions/auth";

export const metadata = { title: { default: "Owner portal", template: "%s · Owner portal" } };

/** Mobile-first owner portal, branded with the organization's color. Everything is limited to the owner's properties. */
export default async function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOwnerPortal();
  const brand = accessibleBrand(ctx.org.brandColor);
  return (
    <div className="min-h-dvh pb-20 md:pb-0" style={{ ["--primary" as string]: brand, ["--ring" as string]: brand }}>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <OrgMark name={ctx.org.name} logoUrl={ctx.org.logoUrl} brand={brand} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold leading-tight">{ctx.org.name}</div>
            <div className="truncate text-sm text-muted-foreground">Owner portal · {ctx.owner.name}</div>
          </div>
          <form action={signOutAction}><button className="rounded-md px-2 py-1 text-sm text-muted-foreground underline-offset-4 hover:underline">Sign out</button></form>
        </div>
        <OwnerNav variant="top" showReports={ctx.settings.showReports} />
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-xs text-muted-foreground">
        Questions? {ctx.org.phone ? <>Call <a className="underline" href={`tel:${ctx.org.phone}`}>{ctx.org.phone}</a></> : null}
        {ctx.org.email ? <> · <a className="underline" href={`mailto:${ctx.org.email}`}>{ctx.org.email}</a></> : null}
      </footer>
      <OwnerNav variant="bottom" showReports={ctx.settings.showReports} />
    </div>
  );
}
