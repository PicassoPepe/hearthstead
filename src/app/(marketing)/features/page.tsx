import { Check } from "lucide-react";
import { FEATURES } from "@/components/marketing/feature-list";
import { appHref, PAYMENTS_LIVE, siteUrl } from "@/lib/seo/site";

export const metadata = {
  title: "Features",
  description: "Rent and late fees, repairs with photos, tenant and owner portals, leases and e-signatures, accounting, county land records and your own rental website — all in DeedWood.",
  alternates: { canonical: `${siteUrl()}/features` },
};

export default function FeaturesPage() {
  const features = FEATURES(PAYMENTS_LIVE());
  return (
    <div className="px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">Features</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">Everything below is in DeedWood today{PAYMENTS_LIVE() ? "" : " (items marked “coming soon” are on the way)"}.</p>
        <div className="mt-10 grid gap-6">
          {features.map((f) => (
            <section key={f.slug} id={f.slug} aria-labelledby={`f-${f.slug}`} className="grid gap-4 rounded-card border border-border bg-surface p-6 shadow-card md:grid-cols-[1fr_1.2fr]">
              <div>
                <f.icon className="size-7 text-primary" aria-hidden />
                <h2 id={`f-${f.slug}`} className="mt-3 text-xl font-semibold">{f.title}{f.soon ? <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">Coming soon</span> : null}</h2>
                <p className="mt-1 text-muted-foreground">{f.short}</p>
              </div>
              <ul className="grid content-start gap-2">{f.points.map((p) => <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />{p}</li>)}</ul>
            </section>
          ))}
        </div>
        <p className="mt-10"><a href={appHref("/signup")} className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-primary-hover">Start free trial</a></p>
      </div>
    </div>
  );
}
