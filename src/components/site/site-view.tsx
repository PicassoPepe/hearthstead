import { BedDouble, Bath, Ruler, Check, MapPin, Phone, Mail, Clock, KeyRound, Wrench, CreditCard, Building2 } from "lucide-react";
import type { Block, SiteContent, Target } from "@/lib/site/blocks";
import { formatMoney } from "@/lib/money";
import { SiteMessageForm } from "./site-forms";
import { siteTheme } from "@/lib/site/theme";
export { siteTheme };

type Org = { name: string; slug: string; phone: string | null; email: string | null; logoUrl: string | null; city: string | null; state: string | null };
type Listing = { id: string; slug: string; title: string; rentCents: number; availableOn: Date | null; beds: number | null; bathsTenths: number | null; sqft: number | null; address: string; photo: string | null };
export type SiteData = { org: Org; site: SiteContent; listings: Listing[]; propertyPhotos: { url: string; alt: string }[]; captchaSiteKey?: string | null };

export function targetHref(t: Target, org: Org, listings: Listing[]) {
  switch (t) {
    case "vacancies": return "#homes";
    case "apply": return listings.length === 1 ? `/apply/${org.slug}/${listings[0]!.slug}` : "#homes";
    case "showing": return "#tour";
    case "contact": return "#contact";
    case "tenantPortal": return "/login?portal=1&callbackUrl=%2Fportal%2Ftenant";
    case "ownerPortal": return "/login?portal=1&callbackUrl=%2Fportal%2Fowner";
    case "payRent": return "/login?portal=1&callbackUrl=%2Fportal%2Ftenant%2Fpay";
    case "maintenance": return "/login?portal=1&callbackUrl=%2Fportal%2Ftenant%2Frequests%2Fnew";
  }
}

const Section = ({ id, title, children, alt }: { id?: string; title?: string; children: React.ReactNode; alt?: boolean }) => (
  <section id={id} aria-labelledby={id && title ? `${id}-h` : undefined} className={`scroll-mt-20 px-4 py-14 sm:py-20 ${alt ? "bg-[var(--site-surface)]" : ""}`}>
    <div className="mx-auto max-w-6xl">
      {title ? <h2 id={id ? `${id}-h` : undefined} className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2> : null}
      {children}
    </div>
  </section>
);
const Para = ({ text, className = "" }: { text: string; className?: string }) => (text ? <p className={`whitespace-pre-line leading-relaxed text-[var(--site-muted)] ${className}`}>{text}</p> : null);

function BlockView({ b, d, preview, i }: { b: Block; d: SiteData; preview?: boolean; i: number }) {
  const { org, listings } = d;
  const alt = i % 2 === 1;
  switch (b.type) {
    case "hero":
      return (
        <section className="relative isolate overflow-hidden bg-[var(--site-primary)] px-4 py-20 text-[var(--site-on-primary)] sm:py-28">
          {b.imageId ? <>{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={`/api/images/${b.imageId}`} alt="" className="absolute inset-0 -z-10 size-full object-cover" /><div className="absolute inset-0 -z-10 bg-black/45" /></> : null}
          <div className={`mx-auto max-w-6xl ${b.imageId ? "text-white" : ""}`}>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{b.headline || org.name}</h1>
            {b.subtext ? <p className="mt-4 max-w-2xl whitespace-pre-line text-lg opacity-90">{b.subtext}</p> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              {b.primary?.label ? <a href={targetHref(b.primary.target, org, listings)} className="rounded-[var(--site-radius)] bg-[var(--site-accent)] px-5 py-3 font-semibold text-white shadow hover:opacity-90">{b.primary.label}</a> : null}
              {b.secondary?.label ? <a href={targetHref(b.secondary.target, org, listings)} className="rounded-[var(--site-radius)] border border-white/60 px-5 py-3 font-semibold hover:bg-white/10">{b.secondary.label}</a> : null}
            </div>
          </div>
        </section>
      );
    case "vacancies":
      return (
        <Section id="homes" title={b.title || "Available homes"} alt={alt}>
          <Para text={b.intro} className="-mt-3 mb-6" />
          {listings.length ? (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="site-vacancies">
              {listings.slice(0, b.max).map((l) => (
                <li key={l.id} className="overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] shadow-sm">
                  <a href={`/l/${org.slug}/${l.slug}`} className="block hover:opacity-95">
                    <div className="relative aspect-[4/3] bg-[var(--site-soft)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.photo ? <img src={l.photo} alt="" loading="lazy" className="size-full object-cover" /> : <Building2 className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 opacity-40" aria-hidden />}
                      {b.showRent ? <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-sm font-semibold text-white">{formatMoney(l.rentCents, { showCents: false })}/mo</span> : null}
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold">{l.title}</h3>
                      <p className="text-sm text-[var(--site-muted)]">{l.address}</p>
                      <p className="mt-2 flex flex-wrap gap-3 text-sm">
                        {l.beds !== null ? <span className="flex items-center gap-1"><BedDouble className="size-4" aria-hidden /> {l.beds === 0 ? "Studio" : `${l.beds} bd`}</span> : null}
                        {l.bathsTenths !== null ? <span className="flex items-center gap-1"><Bath className="size-4" aria-hidden /> {l.bathsTenths / 10} ba</span> : null}
                        {l.sqft ? <span className="flex items-center gap-1"><Ruler className="size-4" aria-hidden /> {l.sqft} sq ft</span> : null}
                      </p>
                      <p className="mt-1 text-xs text-[var(--site-muted)]">{l.availableOn && l.availableOn > new Date() ? `Available ${l.availableOn.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Available now"}</p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-[var(--site-radius)] border border-dashed border-[var(--site-border)] p-8 text-center text-[var(--site-muted)]">No homes are available right now — check back soon, or send us a message and we&apos;ll let you know.</p>}
        </Section>
      );
    case "announcements":
      return b.items.length ? (
        <Section id="news" title={b.title || "News"} alt={alt}>
          <ul className="grid gap-4 md:grid-cols-2" data-testid="site-announcements">
            {b.items.map((a, j) => (
              <li key={j} className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5">
                {a.date ? <p className="text-xs font-semibold uppercase tracking-wide text-[var(--site-muted)]">{new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long" })}</p> : null}
                <h3 className="mt-1 text-lg font-semibold">{a.title}</h3>
                <Para text={a.body} className="mt-2" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null;
    case "apply":
      return (
        <Section id="apply" alt={alt}>
          <div className="flex flex-col items-start gap-4 rounded-[var(--site-radius)] bg-[var(--site-primary)] p-8 text-[var(--site-on-primary)] sm:flex-row sm:items-center">
            <div className="flex-1"><h2 className="text-2xl font-bold">{b.title}</h2>{b.body ? <p className="mt-1 opacity-90">{b.body}</p> : null}</div>
            <a href={targetHref("apply", org, listings)} className="rounded-[var(--site-radius)] bg-[var(--site-accent)] px-5 py-3 font-semibold text-white hover:opacity-90">{b.buttonLabel || "Apply now"}</a>
          </div>
        </Section>
      );
    case "showing":
      return <Section id="tour" title={b.title || "Book a tour"} alt={alt}><Para text={b.body} className="-mt-3 mb-6 max-w-2xl" /><div className="max-w-2xl"><SiteMessageForm orgSlug={org.slug} kind="tour" preview={preview} captchaSiteKey={d.captchaSiteKey} /></div></Section>;
    case "about":
      return (
        <Section id="about" title={b.title || "About us"} alt={alt}>
          <Para text={b.body} className="max-w-3xl text-lg" />
          {b.team.length ? (
            <ul className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
              {b.team.map((m, j) => (
                <li key={j} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.imageId ? <img src={`/api/images/${m.imageId}`} alt="" className="mx-auto size-28 rounded-full object-cover" /> : <span aria-hidden className="mx-auto flex size-28 items-center justify-center rounded-full bg-[var(--site-soft)] text-3xl font-bold">{m.name.slice(0, 1)}</span>}
                  <p className="mt-2 font-semibold">{m.name}</p><p className="text-sm text-[var(--site-muted)]">{m.role}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      );
    case "testimonials":
      return b.items.length ? (
        <Section id="reviews" title={b.title || "What residents say"} alt={alt}>
          <ul className="grid gap-5 md:grid-cols-3">
            {b.items.map((q, j) => <li key={j}><figure className="h-full rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5"><blockquote className="whitespace-pre-line leading-relaxed">“{q.quote}”</blockquote><figcaption className="mt-3 text-sm font-semibold text-[var(--site-muted)]">— {q.name}</figcaption></figure></li>)}
          </ul>
        </Section>
      ) : null;
    case "amenities":
      return b.items.length ? (
        <Section id="amenities" title={b.title || "Amenities"} alt={alt}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{b.items.map((a, j) => <li key={j} className="flex items-center gap-2"><Check className="size-5 shrink-0 text-[var(--site-accent)]" aria-hidden />{a}</li>)}</ul>
        </Section>
      ) : null;
    case "faq":
      return b.items.length ? (
        <Section id="faq" title={b.title || "Common questions"} alt={alt}>
          <div className="grid max-w-3xl gap-2">{b.items.map((f, j) => <details key={j} className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-4"><summary className="cursor-pointer font-semibold">{f.q}</summary><Para text={f.a} className="mt-2" /></details>)}</div>
        </Section>
      ) : null;
    case "gallery": {
      const own = b.imageIds.map((id) => ({ url: `/api/images/${id}`, alt: "" }));
      const photos = [...own, ...(b.fromProperties ? d.propertyPhotos : [])].slice(0, 24);
      return photos.length ? (
        <Section id="photos" title={b.title || "Photos"} alt={alt}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">{photos.map((p, j) => <li key={j}><img src={p.url} alt={p.alt} loading="lazy" className="aspect-square w-full rounded-[var(--site-radius)] object-cover" /></li>)}</ul>
        </Section>
      ) : null;
    }
    case "neighborhood":
      return (
        <Section id="neighborhood" title={b.title || "The neighborhood"} alt={alt}>
          <Para text={b.body} className="max-w-3xl text-lg" />
          {b.address ? <a className="mt-4 inline-flex items-center gap-2 font-semibold text-[var(--site-primary)] underline-offset-4 hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer"><MapPin className="size-4" aria-hidden />See it on a map<span className="sr-only"> (opens in a new tab)</span></a> : null}
        </Section>
      );
    case "contact":
      return (
        <Section id="contact" title={b.title || "Contact us"} alt={alt}>
          <div className="grid gap-8 md:grid-cols-[1fr_1.4fr]">
            <div className="grid content-start gap-3">
              <Para text={b.body} />
              {b.showPhone && org.phone ? <a href={`tel:${org.phone}`} className="flex items-center gap-2 font-semibold"><Phone className="size-4" aria-hidden />{org.phone}</a> : null}
              {b.showEmail && org.email ? <a href={`mailto:${org.email}`} className="flex items-center gap-2 font-semibold"><Mail className="size-4" aria-hidden />{org.email}</a> : null}
              {b.hours ? <p className="flex items-start gap-2 whitespace-pre-line text-[var(--site-muted)]"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden />{b.hours}</p> : null}
            </div>
            <SiteMessageForm orgSlug={org.slug} kind="contact" preview={preview} captchaSiteKey={d.captchaSiteKey} />
          </div>
        </Section>
      );
    case "residents": {
      const links = [
        b.tenantLogin ? { href: targetHref("tenantPortal", org, listings), label: "Resident login", Icon: KeyRound } : null,
        b.payRent ? { href: targetHref("payRent", org, listings), label: "Pay rent", Icon: CreditCard } : null,
        b.maintenance ? { href: targetHref("maintenance", org, listings), label: "Request a repair", Icon: Wrench } : null,
        b.ownerLogin ? { href: targetHref("ownerPortal", org, listings), label: "Owner login", Icon: Building2 } : null,
      ].filter(Boolean) as { href: string; label: string; Icon: typeof KeyRound }[];
      return (
        <Section id="residents" title={b.title || "For residents"} alt={alt}>
          <Para text={b.body} className="-mt-3 mb-6" />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="site-residents">{links.map((l) => <li key={l.label}><a href={l.href} className="flex items-center gap-3 rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-4 font-semibold hover:border-[var(--site-primary)]"><l.Icon className="size-5 text-[var(--site-primary)]" aria-hidden />{l.label}</a></li>)}</ul>
        </Section>
      );
    }
  }
}

const NAV: Partial<Record<Block["type"], [string, string]>> = { vacancies: ["#homes", "Homes"], announcements: ["#news", "News"], about: ["#about", "About"], amenities: ["#amenities", "Amenities"], faq: ["#faq", "FAQ"], residents: ["#residents", "Residents"], contact: ["#contact", "Contact"] };

/** The public website. Rendered on the server; only the forms are interactive. */
export function SiteView({ d, preview }: { d: SiteData; preview?: boolean }) {
  const { site, org } = d;
  const shown = site.sections.filter((s) => s.enabled);
  const nav = shown.map((s) => NAV[s.type]).filter((x): x is [string, string] => Boolean(x));
  return (
    <div style={{ ...(siteTheme(site.theme) as React.CSSProperties), fontFamily: "var(--site-font)" }} className="site min-h-dvh bg-[var(--site-bg)] text-[var(--site-text)] motion-safe:scroll-smooth">
      <a href="#site-main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-[var(--site-border)] bg-[var(--site-surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href="#" className="flex items-center gap-2 font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {org.logoUrl ? <img src={org.logoUrl} alt="" className="h-9 w-auto max-w-36 object-contain" /> : null}
            <span className="text-lg">{site.title || org.name}</span>
          </a>
          <nav aria-label="Website" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">{nav.map(([href, label]) => <a key={href} href={href} className="hover:text-[var(--site-primary)] hover:underline underline-offset-4">{label}</a>)}</nav>
          {org.phone ? <a href={`tel:${org.phone}`} className="ml-auto hidden text-sm font-semibold sm:block">{org.phone}</a> : null}
        </div>
      </header>
      <main id="site-main">
        {shown.map((b, i) => <BlockView key={b.id} b={b} d={d} preview={preview} i={i} />)}
      </main>
      <footer className="border-t border-[var(--site-border)] bg-[var(--site-surface)] px-4 py-10 text-sm text-[var(--site-muted)]">
        <div className="mx-auto grid max-w-6xl gap-3">
          {site.footerText ? <p className="whitespace-pre-line">{site.footerText}</p> : null}
          <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--site-text)]"><span aria-hidden className="inline-flex size-6 items-center justify-center rounded border border-current text-[10px] font-bold">EHO</span>Equal Housing Opportunity. We do business in accordance with the Fair Housing Act and do not discriminate on the basis of race, color, religion, sex, disability, familial status or national origin.</p>
          <p>© {new Date().getFullYear()} {org.name}{org.city ? ` · ${org.city}${org.state ? `, ${org.state}` : ""}` : ""} · Powered by DeedWood</p>
        </div>
      </footer>
    </div>
  );
}
