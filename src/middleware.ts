import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/server/auth/config";
import { siteSlugForHost } from "@/lib/site/hosts";
import { wwwRedirectUrl } from "@/lib/www-redirect";

const { auth } = NextAuth(authConfig);

/** Paths that belong to a company website when it's opened on its own address. */
const SITE_PATHS = new Set(["/", "/sitemap.xml", "/robots.txt"]);
const cache = new Map<string, { slug: string | null; at: number }>();

async function resolveCustomDomain(host: string, req: NextRequest): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.slug;
  let slug: string | null = null;
  try {
    const base = process.env.AUTH_URL ?? req.nextUrl.origin;
    const r = await fetch(new URL(`/api/sites/resolve?host=${encodeURIComponent(host)}`, base), { signal: AbortSignal.timeout(3000) });
    slug = r.ok ? ((await r.json()) as { slug: string | null }).slug : null;
  } catch {
    slug = null;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(host, { slug, at: Date.now() });
  return slug;
}

/** www.<apex> → apex, then company websites on their own addresses. */
export default auth(async (req) => {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const apex = wwwRedirectUrl(host, req.nextUrl.pathname, req.nextUrl.search, { SITE_URL: process.env.SITE_URL, AUTH_URL: process.env.AUTH_URL });
  if (apex) return NextResponse.redirect(apex, 301);

  const path = req.nextUrl.pathname;
  if (!SITE_PATHS.has(path)) return;
  const siteHost = host.split(",")[0]!.trim().split(":")[0]!.toLowerCase();
  const r = siteSlugForHost(siteHost, { appUrl: process.env.AUTH_URL, rootDomain: process.env.SITES_ROOT_DOMAIN });
  const slug = r.kind === "slug" ? r.slug : r.kind === "custom" ? await resolveCustomDomain(siteHost, req) : null;
  if (!slug) return;
  const url = req.nextUrl.clone();
  url.pathname = `/s/${slug}${path === "/" ? "" : path}`;
  const headers = new Headers(req.headers);
  headers.set("x-site-host", siteHost);
  return NextResponse.rewrite(url, { request: { headers } });
});

export const config = {
  // Every page, so www.deedwood.com/<anything> can 301 to the apex. Skip build assets.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg|woff2)$).*)"],
};
