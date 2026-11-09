import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getContext } from "@/server/context";
import { getPortalContext } from "@/server/portal/context";
import { getOwnerPortalContext } from "@/server/portal/owner-context";
import { publicPlans } from "@/server/billing/public-plans";
import { FEATURES } from "@/components/marketing/feature-list";
import { appHref, BRAND, PAYMENTS_LIVE, siteUrl } from "@/lib/seo/site";
import { faqLd, ldJson, organizationLd, softwareLd } from "@/lib/seo/jsonld";

export const dynamic = "force-dynamic";

export const metadata = {
  title: { absolute: "DeedWood — simple property management software for landlords" },
  description: BRAND.description,
  alternates: { canonical: `${siteUrl()}/` },
  openGraph: { title: "DeedWood — property management made simple", description: BRAND.description, url: `${siteUrl()}/`, images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "DeedWood" }] },
};

const FAQ = [
  { q: "Who is DeedWood for?", a: "Landlords and small-to-mid property managers — from a few houses to a few hundred units — who want software that's easy enough for anyone on the team to use." },
  { q: "Do I need to install anything?", a: "No. Use DeedWood online from any browser. If you'd rather keep everything on your own computer, there's a Local version that starts with one double-click." },
  { q: "Can my tenants use it on their phones?", a: "Yes. The resident portal works on any phone: see the balance, report a repair with photos, and message you." },
  { q: "Is there a free trial?", a: "Yes — start a free trial and load sample data to look around before adding your own properties." },
];

export default async function Home() {
  // Signed-in people go straight to their workspace.
  if (process.env.MARKETING_STATIC !== "1") {
    const ctx = await getContext();
    if (ctx) redirect("/app/overview");
    if (await getPortalContext()) redirect("/portal/tenant");
    if (await getOwnerPortalContext()) redirect("/portal/owner");
  }

  const plans = await publicPlans();
  const features = FEATURES(PAYMENTS_LIVE());
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([organizationLd(), softwareLd(plans), faqLd(FAQ)]) }} />
      <section className="bg-gradient-to-br from-[#18383B] via-[#0C4C54] to-[#0E5A63] px-4 py-20 text-white sm:py-28">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#E9C7A8]">Property management software</p>
          <h1 className="mt-2 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Property management made simple — for you, your team and your tenants.</h1>
          <p className="mt-5 max-w-2xl text-lg text-teal-50">Track rent, fix repairs with photos, give tenants and owners their own portals, and publish a rental website — in plain words anyone can use.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={appHref("/signup")} className="rounded-lg bg-[#8F5A3A] px-5 py-3 font-semibold text-white shadow hover:opacity-90">Start free trial</a>
            <Link href="/pricing" className="rounded-lg border border-white/60 px-5 py-3 font-semibold hover:bg-white/10">See pricing</Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-teal-50">
            {["No credit card to start", "Works on phones", "Online or on your own computer"].map((t) => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4" aria-hidden />{t}</li>)}
          </ul>
        </div>
      </section>

      <section aria-labelledby="features-h" className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 id="features-h" className="font-display text-3xl font-bold tracking-tight">Everything a landlord needs, nothing they don&apos;t</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">Big buttons, plain words and a “What do you want to do?” home page — built so anyone can run it.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.slice(0, 9).map((f) => (
              <li key={f.slug} className="rounded-card border border-border bg-surface p-5 shadow-card">
                <f.icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold">{f.title}{f.soon ? <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">Coming soon</span> : null}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.short}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6"><Link href="/features" className="font-semibold text-primary underline-offset-4 hover:underline">See all features →</Link></p>
        </div>
      </section>

      <section aria-labelledby="how-h" className="bg-surface px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 id="how-h" className="font-display text-3xl font-bold tracking-tight">Up and running in an afternoon</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[["Add your properties", "Type them in or import a spreadsheet. DeedWood can even pull the county land record and an aerial photo."], ["Add tenants and leases", "Rent and late fees post on their own. Invite tenants to their portal."], ["Run the day-to-day", "Repairs with photos, messages, payments and reports — all from one simple home page."]].map(([t, d], i) => (
              <li key={t} className="rounded-card border border-border bg-background p-5">
                <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">{i + 1}</span>
                <h3 className="mt-3 font-semibold">{t}</h3><p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="faq-h" className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 id="faq-h" className="font-display text-3xl font-bold tracking-tight">Common questions</h2>
          <div className="mt-6 grid gap-2">{FAQ.map((f) => <details key={f.q} className="rounded-card border border-border bg-surface p-4"><summary className="cursor-pointer font-semibold">{f.q}</summary><p className="mt-2 text-muted-foreground">{f.a}</p></details>)}</div>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 rounded-card bg-primary p-8 text-primary-foreground sm:flex-row sm:items-center">
          <div className="flex-1"><h2 className="font-display text-2xl font-bold">Try DeedWood free</h2><p className="mt-1 opacity-90">Load sample data and click around — no credit card needed.</p></div>
          <a href={appHref("/signup")} className="rounded-lg bg-[#8F5A3A] px-5 py-3 font-semibold text-white hover:opacity-90">Start free trial</a>
        </div>
      </section>
    </>
  );
}
