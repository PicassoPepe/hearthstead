import Link from "next/link";

/** Minimal branded shell for public pages (listings, apply, sign). */
export function PublicShell({ org, brand, children, home }: { org: { name: string; phone: string | null; email: string | null; slug: string }; brand: string; children: React.ReactNode; home?: boolean }) {
  return (
    <div className="portal-density min-h-dvh bg-background" style={{ ["--primary" as string]: brand, ["--ring" as string]: brand }}>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: brand }}>{org.name.slice(0, 1)}</span>
          {home ? <span className="font-semibold">{org.name}</span> : <Link href={`/l/${org.slug}`} className="font-semibold hover:underline">{org.name}</Link>}
          <span className="ml-auto text-sm text-muted-foreground">{org.phone ? <a className="hover:underline" href={`tel:${org.phone}`}>{org.phone}</a> : null}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-muted-foreground">{org.name}{org.email ? <> · <a className="underline" href={`mailto:${org.email}`}>{org.email}</a></> : null} · Equal Housing Opportunity</footer>
    </div>
  );
}
