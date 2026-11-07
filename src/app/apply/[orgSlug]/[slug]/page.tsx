import { notFound } from "next/navigation";
import { publishedListings } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";
import { ApplyStart } from "@/components/funnel/apply-start";
import { getSettings } from "@/server/settings/service";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apply" };

export default async function ApplyStartPage({ params }: { params: Promise<{ orgSlug: string; slug: string }> }) {
  const { orgSlug, slug } = await params;
  const d = await publishedListings(orgSlug);
  const l = d?.listings.find((x) => x.slug === slug);
  if (!d || !l) notFound();
  const fee = (await getSettings(d.db, ["applications.feeCents"], { orgId: d.org.id, propertyId: l.propertyId }))["applications.feeCents"].value;
  return (
    <PublicShell org={d.org} brand={d.brand}>
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">Apply for {l.title}</h1>
        <p className="mt-1 text-muted-foreground">{formatMoney(l.rentCents)}/month · {l.property.city}</p>
        <ul className="my-5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>About 10 minutes — answers save automatically.</li>
          <li>Have your employer and current landlord details handy.</li>
          <li>{fee ? `${formatMoney(fee)} application fee (non-refundable), paid by card at the end.` : "No application fee."}</li>
          <li>We run a credit, eviction and background check when you submit, with your permission.</li>
        </ul>
        <ApplyStart orgSlug={orgSlug} slug={slug} />
      </div>
    </PublicShell>
  );
}
