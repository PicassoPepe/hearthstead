import Link from "next/link";
import { notFound } from "next/navigation";
import { BedDouble, Bath, Ruler } from "lucide-react";
import { publishedListings } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }) {
  const d = await publishedListings((await params).orgSlug);
  return { title: d ? `Homes for rent · ${d.org.name}` : "Not found" };
}

export default async function PublicListings({ params }: { params: Promise<{ orgSlug: string }> }) {
  const d = await publishedListings((await params).orgSlug);
  if (!d) notFound();
  return (
    <PublicShell org={d.org} brand={d.brand} home>
      <h1 className="text-3xl font-semibold tracking-tight">Homes for rent</h1>
      <p className="mt-1 text-muted-foreground">{d.listings.length} available from {d.org.name}. Book a showing or apply online.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {d.listings.map((l) => (
          <li key={l.id} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <div className="relative flex h-44 items-end bg-gradient-to-br from-primary/80 to-primary/40 p-3 text-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.photos[0] ? <img src={l.photos[0]} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : null}
              <span className="relative rounded bg-black/55 px-2 py-0.5 text-sm font-semibold">{formatMoney(l.rentCents, { showCents: false })}/mo</span>
            </div>
            <div className="p-4">
              <h2 className="font-semibold"><Link href={`/l/${d.org.slug}/${l.slug}`} className="hover:underline">{l.title}</Link></h2>
              <p className="text-sm text-muted-foreground">{l.property.addressLine1}, {l.property.city}</p>
              <p className="mt-2 flex flex-wrap gap-3 text-sm">
                {l.unit.beds !== null ? <span className="flex items-center gap-1"><BedDouble className="size-4" aria-hidden /> {l.unit.beds === 0 ? "Studio" : `${l.unit.beds} bd`}</span> : null}
                {l.unit.bathsTenths !== null ? <span className="flex items-center gap-1"><Bath className="size-4" aria-hidden /> {l.unit.bathsTenths / 10} ba</span> : null}
                {l.unit.sqft ? <span className="flex items-center gap-1"><Ruler className="size-4" aria-hidden /> {l.unit.sqft} sq ft</span> : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Available {l.availableOn ? formatDate(l.availableOn) : "now"}</p>
            </div>
          </li>
        ))}
      </ul>
      {!d.listings.length ? <p className="mt-10 rounded-card border border-dashed border-border p-10 text-center text-muted-foreground">No homes available right now — check back soon.</p> : null}
    </PublicShell>
  );
}
