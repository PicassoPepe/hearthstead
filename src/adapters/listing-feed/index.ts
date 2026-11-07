/**
 * ListingFeedProvider adapter: renders published listings as a syndication feed that listing
 * sites poll. `file` (default) serves a generic XML feed (also JSON) at /api/listings/feed/<org>.
 */
export type FeedListing = {
  id: string; url: string; title: string; description: string; rentCents: number; depositCents: number; availableOn: string | null;
  beds: number | null; baths: number | null; sqft: number | null; address: { street: string; city: string; state: string; postalCode: string }; photos: string[]; petPolicy: string; updatedAt: string;
};

export interface ListingFeedProvider {
  readonly name: string;
  render(org: { name: string; url: string }, listings: FeedListing[], format: "xml" | "json"): { body: string; contentType: string };
}

const x = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

class FileFeedProvider implements ListingFeedProvider {
  readonly name = "file";
  render(org: { name: string; url: string }, listings: FeedListing[], format: "xml" | "json") {
    if (format === "json") return { body: JSON.stringify({ company: org, listings }, null, 2), contentType: "application/json" };
    const items = listings.map((l) => `  <listing id="${x(l.id)}">
    <url>${x(l.url)}</url><title>${x(l.title)}</title><description>${x(l.description)}</description>
    <rent currency="USD">${(l.rentCents / 100).toFixed(2)}</rent><deposit currency="USD">${(l.depositCents / 100).toFixed(2)}</deposit>
    <available>${l.availableOn ?? "now"}</available>${l.beds !== null ? `<beds>${l.beds}</beds>` : ""}${l.baths !== null ? `<baths>${l.baths}</baths>` : ""}${l.sqft !== null ? `<sqft>${l.sqft}</sqft>` : ""}
    <address><street>${x(l.address.street)}</street><city>${x(l.address.city)}</city><state>${x(l.address.state)}</state><zip>${x(l.address.postalCode)}</zip></address>
    <pets>${x(l.petPolicy)}</pets>${l.photos.map((p) => `<photo>${x(p)}</photo>`).join("")}<updated>${l.updatedAt}</updated>
  </listing>`).join("\n");
    return { body: `<?xml version="1.0" encoding="UTF-8"?>\n<listings company="${x(org.name)}" url="${x(org.url)}">\n${items}\n</listings>\n`, contentType: "application/xml" };
  }
}

let p: ListingFeedProvider | undefined;
export function getListingFeedProvider(): ListingFeedProvider {
  p ??= new FileFeedProvider();
  return p;
}
