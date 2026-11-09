import { notFound } from "next/navigation";
import { getContext } from "@/server/context";
import { publicSite } from "@/server/site/service";
import { SiteView } from "@/components/site/site-view";
import { captchaSiteKey } from "@/server/auth/captcha";
import { siteSchema } from "@/lib/site/blocks";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ preview?: string }> };

/** Staff of this company can preview the unpublished draft with ?preview=1. */
async function load({ params, searchParams }: P) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  let draft = false;
  if (sp.preview === "1") {
    const ctx = await getContext();
    draft = Boolean(ctx && ctx.org.slug === orgSlug);
  }
  return { d: await publicSite(orgSlug, { draft }), draft };
}

export async function generateMetadata(p: P) {
  const { d } = await load(p);
  if (!d) return { title: "Not found" };
  const hero = d.site.sections.find((s) => s.type === "hero" && s.enabled);
  const image = hero && hero.type === "hero" && hero.imageId ? `/api/images/${hero.imageId}` : d.org.logoUrl ?? undefined;
  const title = d.site.title || d.org.name;
  return {
    title: { absolute: d.site.tagline ? `${title} — ${d.site.tagline}` : title },
    description: d.site.seoDescription || undefined,
    icons: d.org.logoUrl ? { icon: d.org.logoUrl } : undefined,
    openGraph: { title, description: d.site.seoDescription || undefined, siteName: title, type: "website", images: image ? [image] : undefined },
    alternates: { canonical: `/s/${d.org.slug}` },
  };
}

export default async function SitePage(p: P) {
  const { d, draft } = await load(p);
  if (!d) notFound();
  siteSchema.parse(d.site);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "RealEstateAgent", name: d.org.name, telephone: d.org.phone ?? undefined, email: d.org.email ?? undefined, address: d.org.city ? { "@type": "PostalAddress", addressLocality: d.org.city, addressRegion: d.org.state ?? undefined } : undefined },
      ...d.listings.slice(0, 30).map((l) => ({ "@type": "RealEstateListing", name: l.title, url: `/l/${d.org.slug}/${l.slug}`, offers: { "@type": "Offer", price: (l.rentCents / 100).toFixed(2), priceCurrency: "USD" } })),
    ],
  };
  return (
    <>
      {draft ? <p role="status" className="sticky top-0 z-40 bg-[#78350f] px-4 py-1.5 text-center text-sm font-semibold text-white">Preview — this is your unpublished draft. Visitors don&apos;t see these changes until you press Publish.</p> : null}
      {/* JSON-LD: data only, escaped so it can't close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {d.site.analytics.plausibleDomain ? <script defer data-domain={d.site.analytics.plausibleDomain} src="https://plausible.io/js/script.js" /> : null}
      <SiteView d={{ ...d, captchaSiteKey: captchaSiteKey() }} preview={draft} />
    </>
  );
}
