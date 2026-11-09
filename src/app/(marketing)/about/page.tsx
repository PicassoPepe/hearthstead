import { BRAND, appHref, siteUrl } from "@/lib/seo/site";

export const metadata = { title: "About & contact", description: "DeedWood is property management software built in Kentucky for landlords and property managers who want something simple.", alternates: { canonical: `${siteUrl()}/about` } };

export default function AboutPage() {
  return (
    <div className="px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">About DeedWood</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">DeedWood is built in {BRAND.region} for landlords and property managers who want software that anyone on their team can use — big buttons, plain words, and everything in one place: rent, repairs, tenants, owners, money and a rental website.</p>
        <h2 className="mt-10 text-2xl font-bold">Contact</h2>
        <p className="mt-2 text-muted-foreground">{BRAND.email ? <>Email us at <a className="font-medium text-primary underline" href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.</> : "Sign in and use Help → Contact support, or start a free trial and we'll be in touch."}</p>
        <p className="mt-6"><a href={appHref("/signup")} className="rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-primary-hover">Start free trial</a></p>
      </div>
    </div>
  );
}
