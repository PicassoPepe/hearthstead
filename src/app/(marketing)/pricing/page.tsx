import Link from "next/link";
import { Check } from "lucide-react";
import { publicPlans } from "@/server/billing/public-plans";
import { quote } from "@/lib/pricing";
import { FEATURES as FEATURE_NAMES } from "@/lib/entitlements";
import { formatMoney } from "@/lib/money";
import { appHref, siteUrl } from "@/lib/seo/site";
import { faqLd, ldJson, softwareLd } from "@/lib/seo/jsonld";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pricing",
  description: "Simple pricing: Starter $49/month for up to 25 units, Growth $2.50 per unit, Scale $1.75 per unit, or run DeedWood on your own computer for $15 per unit per year.",
  alternates: { canonical: `${siteUrl()}/pricing` },
};

const FAQ = [
  { q: "What counts as a unit?", a: "Each rentable home: a house is one unit, an apartment building has one unit per apartment." },
  { q: "Is there a contract?", a: "No. Pay monthly and cancel any time, or pay yearly and save about 17%." },
  { q: "What's the Local version?", a: "DeedWood running on your own computer or server, with a yearly license that includes updates and email support." },
  { q: "Do you charge sales tax?", a: "Where required — for example, Kentucky taxes software subscriptions at 6%." },
];

const money = (c: number) => formatMoney(c, { showCents: c % 100 !== 0 });

export default async function PricingPage() {
  const plans = await publicPlans();
  const hosted = plans.filter((p) => p.mode === "HOSTED");
  const local = plans.filter((p) => p.mode === "SELF_HOSTED");
  const addons = plans.filter((p) => p.mode === "ADDON");
  const headline = (p: (typeof plans)[number]) =>
    p.monthlyFlatCents != null ? <><span className="text-4xl font-bold">{money(p.monthlyFlatCents)}</span><span className="text-muted-foreground">/month</span></>
    : p.monthlyPerUnitCents != null ? <><span className="text-4xl font-bold">{money(p.monthlyPerUnitCents)}</span><span className="text-muted-foreground">/unit/month</span></>
    : <><span className="text-4xl font-bold">{money(p.annualPerUnitCents ?? 0)}</span><span className="text-muted-foreground">/unit/year</span></>;
  return (
    <div className="px-4 py-14 sm:py-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([softwareLd(plans), faqLd(FAQ)]) }} />
      <div className="mx-auto max-w-6xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">Simple pricing</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">One price for everything in your plan — no setup fees, no per-user charges for your tenants or owners.</p>

        <h2 className="mt-12 text-2xl font-bold">Online (we host it)</h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {hosted.map((p) => (
            <li key={p.key} className="flex flex-col rounded-card border border-border bg-surface p-6 shadow-card" data-testid={`price-${p.key}`}>
              <h3 className="text-xl font-semibold">{p.displayName}</h3>
              <p className="text-sm text-muted-foreground">{p.unitMax ? `${p.unitMin}–${p.unitMax} units` : `${p.unitMin}+ units`}</p>
              <p className="mt-4">{headline(p)}</p>
              <p className="text-sm text-muted-foreground">{p.monthlyMinCents ? `${money(p.monthlyMinCents)} minimum a month · ` : ""}{p.annualFlatCents ? `or ${money(p.annualFlatCents)}/year` : p.annualPerUnitCents ? `or ${money(p.annualPerUnitCents)}/unit yearly` : ""}{p.volumeAboveUnits && p.volumeMonthlyCents ? ` · ${money(p.volumeMonthlyCents)}/unit above ${p.volumeAboveUnits} units` : ""}</p>
              <p className="mt-3 text-sm">{p.description}</p>
              <ul className="mt-4 grid flex-1 content-start gap-1.5 text-sm">{p.features.slice(-5).map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{FEATURE_NAMES[f as keyof typeof FEATURE_NAMES] ?? f}</li>)}</ul>
              <p className="mt-4 text-xs text-muted-foreground">Example: {p.unitMax && p.unitMax <= 25 ? `20 units = ${money(quote(p, 20, "month"))}/month` : p.unitMax ? `60 units = ${money(quote(p, 60, "month"))}/month` : `150 units = ${money(quote(p, 150, "month"))}/month`}</p>
              <a href={appHref("/signup")} className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-center font-semibold text-primary-foreground hover:bg-primary-hover">Start free trial</a>
            </li>
          ))}
        </ul>

        <h2 className="mt-14 text-2xl font-bold">On your own computer</h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {local.map((p) => (
            <li key={p.key} className="rounded-card border border-border bg-surface p-6 shadow-card" data-testid={`price-${p.key}`}>
              <h3 className="text-xl font-semibold">{p.displayName}</h3>
              <p className="mt-3">{headline(p)}</p>
              <p className="text-sm text-muted-foreground">{p.annualMinCents ? `${money(p.annualMinCents)} minimum a year` : ""}{p.addOnAnnualCents ? ` · plus ${money(p.addOnAnnualCents)}/year for Care` : ""}</p>
              <p className="mt-3 text-sm">{p.description}</p>
            </li>
          ))}
        </ul>

        {addons.length ? (
          <>
            <h2 className="mt-14 text-2xl font-bold">Add-ons</h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">{addons.map((p) => <li key={p.key} className="rounded-card border border-border bg-surface p-4 text-sm"><p className="font-semibold">{p.displayName} — {money(p.monthlyFlatCents ?? 0)}{p.key === "addon_sms_500" ? "" : "/month"}</p><p className="text-muted-foreground">{p.description}</p></li>)}</ul>
          </>
        ) : null}

        <h2 className="mt-14 text-2xl font-bold">Questions</h2>
        <div className="mt-4 grid max-w-3xl gap-2">{FAQ.map((f) => <details key={f.q} className="rounded-card border border-border bg-surface p-4"><summary className="cursor-pointer font-semibold">{f.q}</summary><p className="mt-2 text-muted-foreground">{f.a}</p></details>)}</div>
        <p className="mt-8 text-sm text-muted-foreground">Prices in US dollars. Sales tax added where required. <Link href="/terms" className="underline">Terms</Link></p>
      </div>
    </div>
  );
}
