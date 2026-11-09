import { BRAND, siteUrl } from "./site";

type Plan = { displayName: string; key: string; mode: string; monthlyFlatCents?: number | null; monthlyPerUnitCents?: number | null; monthlyMinCents?: number | null; annualPerUnitCents?: number | null; annualMinCents?: number | null };

/** JSON-LD (schema.org) for the marketing site. No self-serving ratings or reviews — ever. */
export function organizationLd() {
  return { "@context": "https://schema.org", "@type": "Organization", name: BRAND.legalName, alternateName: BRAND.name, url: siteUrl(), logo: `${siteUrl()}/logo.png`, ...(BRAND.email ? { email: BRAND.email } : {}), areaServed: "US" };
}

export function softwareLd(plans: Plan[]) {
  const price = (p: Plan) => p.monthlyFlatCents ?? p.monthlyMinCents ?? p.annualMinCents;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: BRAND.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Windows, macOS",
    description: BRAND.description,
    url: siteUrl(),
    offers: plans.filter((p) => p.mode !== "ADDON" && price(p) != null).map((p) => ({ "@type": "Offer", name: p.displayName, price: (price(p)! / 100).toFixed(2), priceCurrency: "USD", url: `${siteUrl()}/pricing` })),
  };
}

export function faqLd(items: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) };
}

/** Safe to put in a <script> tag: "<" can't close it. */
export const ldJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
