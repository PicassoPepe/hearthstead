/**
 * Where the marketing site lives and where its buttons send people.
 * - SITE_URL: the public marketing address (e.g. https://deedwood.com). Used for canonical links,
 *   the sitemap and social previews. Falls back to AUTH_URL.
 * - MARKETING_APP_URL: the app's address for "Sign in" / "Start free trial" when the marketing
 *   pages are exported as a static folder (Cloudflare Pages). Empty = same site.
 */
export const siteUrl = () => (process.env.SITE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const appHref = (path: string) => `${(process.env.MARKETING_APP_URL ?? "").replace(/\/$/, "")}${path}`;
export const BRAND = {
  name: "DeedWood",
  legalName: "DeedWood LLC",
  tagline: "Property management made simple",
  description: "DeedWood is simple property management software for landlords and property managers: rent tracking, repairs with photos, tenant and owner portals, accounting, leases, county land records and your own rental website.",
  /** Public contact email — set CONTACT_EMAIL; nothing is shown until it is. */
  email: process.env.CONTACT_EMAIL ?? null,
  region: "Kentucky, USA",
} as const;
export const PAYMENTS_LIVE = () => process.env.PAYMENTS_ENABLED === "1";
