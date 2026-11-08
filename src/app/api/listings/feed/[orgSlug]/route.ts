import { NextResponse } from "next/server";
import { publishedListings } from "@/server/public/listings";
import { getListingFeedProvider } from "@/adapters/listing-feed";

/** Syndication feed of published listings (XML by default, ?format=json). */
export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const d = await publishedListings(orgSlug);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const base = process.env.AUTH_URL ?? new URL(req.url).origin;
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "xml";
  const r = getListingFeedProvider().render({ name: d.org.name, url: `${base}/l/${orgSlug}` }, d.listings.filter((l) => l.syndicate).map((l) => ({
    id: l.id, url: `${base}/l/${orgSlug}/${l.slug}`, title: l.title, description: l.description, rentCents: l.rentCents, depositCents: l.depositCents,
    availableOn: l.availableOn ? l.availableOn.toISOString().slice(0, 10) : null, beds: l.unit.beds, baths: l.unit.bathsTenths !== null ? l.unit.bathsTenths / 10 : null, sqft: l.unit.sqft,
    address: { street: l.property.addressLine1, city: l.property.city, state: l.property.state, postalCode: l.property.postalCode }, photos: l.photos.map((p) => `${base}${p}`), petPolicy: l.petPolicy, updatedAt: l.updatedAt.toISOString(),
  })), format);
  return new NextResponse(r.body, { headers: { "content-type": `${r.contentType}; charset=utf-8`, "cache-control": "public, max-age=300" } });
}
