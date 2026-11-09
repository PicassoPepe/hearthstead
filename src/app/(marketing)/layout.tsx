import Link from "next/link";
import { appHref, BRAND } from "@/lib/seo/site";

/** Public marketing pages: simple header, generous spacing, the same low-eye-strain colors as the app. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const nav = [["Features", "/features"], ["Pricing", "/pricing"], ["Security", "/security"], ["About", "/about"]] as const;
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="shrink-0" aria-label="DeedWood home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="DeedWood" width={187} height={48} className="h-12 w-auto" />
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
            {nav.map(([label, href]) => <Link key={href} href={href} className="hover:text-primary hover:underline underline-offset-4">{label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <a href={appHref("/login")} className="rounded-lg px-3 py-2 font-medium hover:bg-surface-muted">Sign in</a>
            <a href={appHref("/signup")} className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary-hover">Start free trial</a>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="DeedWood" width={125} height={32} className="h-8 w-auto" />
            <p className="mt-2 text-muted-foreground">{BRAND.tagline}. Built in {BRAND.region}.</p>
          </div>
          <nav aria-label="Product" className="grid content-start gap-1.5"><p className="font-semibold">Product</p><Link href="/features" className="text-muted-foreground hover:text-foreground">Features</Link><Link href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link><Link href="/security" className="text-muted-foreground hover:text-foreground">Security</Link><a href={appHref("/login")} className="text-muted-foreground hover:text-foreground">Sign in</a></nav>
          <nav aria-label="Company" className="grid content-start gap-1.5"><p className="font-semibold">Company</p><Link href="/about" className="text-muted-foreground hover:text-foreground">About &amp; contact</Link><Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link><Link href="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link></nav>
        </div>
        <p className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {BRAND.legalName}. DeedWood is software, not legal, tax or accounting advice.</p>
      </footer>
    </div>
  );
}
