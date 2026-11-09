import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/server/auth/config";
import { siteSlugForHost } from "@/lib/site/hosts";

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

/** Sign-in protection for /app, /portal, /admin — plus company websites on their own addresses. */
export default auth(async (req) => {
  const path = req.nextUrl.pathname;
  if (!SITE_PATHS.has(path)) return;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  const r = siteSlugForHost(host, { appUrl: process.env.AUTH_URL, rootDomain: process.env.SITES_ROOT_DOMAIN });
  const slug = r.kind === "slug" ? r.slug : r.kind === "custom" ? await resolveCustomDomain(host, req) : null;
  if (!slug) return;
  const url = req.nextUrl.clone();
  url.pathname = `/s/${slug}${path === "/" ? "" : path}`;
  const headers = new Headers(req.headers);
  headers.set("x-site-host", host);
  return NextResponse.rewrite(url, { request: { headers } });
});

export const config = {
  matcher: ["/", "/sitemap.xml", "/robots.txt", "/app/:path*", "/portal/:path*", "/admin/:path*", "/admin", "/select-org"],
};
