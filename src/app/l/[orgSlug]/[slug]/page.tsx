import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedListings } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";
import { RequestShowing } from "@/components/funnel/request-showing";
import { Button } from "@/components/ui/button";
import { PhotoStrip } from "@/components/images/photo-gallery";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Next 7 days, 10am–6pm on the hour, minus booked slots. */
async function openSlots(db: NonNullable<Awaited<ReturnType<typeof publishedListings>>>["db"], listingId: string, tz: string) {
  const booked = (await db.showing.findMany({ where: { listingId, status: "SCHEDULED", startsAt: { gte: new Date() } }, select: { startsAt: true } })).map((s) => s.startsAt.getTime());
  const out: { iso: string; label: string }[] = [];
  const now = new Date();
  for (let d = 1; d <= 7; d++) {
    for (const h of [10, 11, 12, 14, 15, 16, 17]) {
      const local = new Date(now.getTime() + d * 86_400_000);
      const day = local.toLocaleDateString("en-CA", { timeZone: tz });
      // Interpret h:00 in the org's timezone.
      const guess = new Date(`${day}T${String(h).padStart(2, "0")}:00:00Z`);
      const offset = guess.getTime() - new Date(guess.toLocaleString("en-US", { timeZone: tz })).getTime();
      const at = new Date(guess.getTime() + offset);
      if (booked.some((b) => Math.abs(b - at.getTime()) < 30 * 60_000)) continue;
      out.push({ iso: at.toISOString(), label: at.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) });
    }
  }
  return out;
}

export default async function PublicListing({ params }: { params: Promise<{ orgSlug: string; slug: string }> }) {
  const { orgSlug, slug } = await params;
  const d = await publishedListings(orgSlug);
  const l = d?.listings.find((x) => x.slug === slug);
  if (!d || !l) notFound();
  const slots = await openSlots(d.db, l.id, d.org.timezone);
  return (
    <PublicShell org={d.org} brand={d.brand}>
      <p className="text-sm"><Link href={`/l/${orgSlug}`} className="text-primary hover:underline">← All homes</Link></p>
      <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_340px]">
        <article>
          <PhotoStrip urls={l.photos} className="mb-6" />
          <h1 className="text-3xl font-semibold tracking-tight">{l.title}</h1>
          <p className="mt-1 text-muted-foreground">{l.property.addressLine1}, {l.property.city}, {l.property.state} {l.property.postalCode}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Rent", `${formatMoney(l.rentCents, { showCents: false })}/mo`], ["Deposit", formatMoney(l.depositCents, { showCents: false })], ["Beds / baths", `${l.unit.beds ?? "—"} / ${l.unit.bathsTenths !== null ? l.unit.bathsTenths / 10 : "—"}`], ["Available", l.availableOn ? formatDate(l.availableOn) : "Now"]].map(([k, v]) => (
              <div key={k} className="rounded-card border border-border bg-surface p-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-6 space-y-3 whitespace-pre-line leading-relaxed">{l.description}</div>
          <p className="mt-4 text-sm"><strong>Pets:</strong> {l.petPolicy} · <strong>Lease:</strong> {l.leaseTermMonths} months{l.unit.amenities.length ? <> · <strong>Amenities:</strong> {l.unit.amenities.join(", ")}</> : null}</p>
        </article>
        <aside className="grid content-start gap-4">
          <div className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h2 className="font-semibold">Ready to apply?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Takes about 10 minutes. Your progress saves as you go.</p>
            <Button asChild className="mt-3 w-full"><Link href={`/apply/${orgSlug}/${slug}`}>Apply now</Link></Button>
          </div>
          <div className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h2 className="mb-3 font-semibold">Book a showing</h2>
            <RequestShowing orgSlug={orgSlug} slug={slug} slots={slots} />
          </div>
        </aside>
      </div>
    </PublicShell>
  );
}
