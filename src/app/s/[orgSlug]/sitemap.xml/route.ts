import { publicSite } from "@/server/site/service";

export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const d = await publicSite((await params).orgSlug);
  if (!d) return new Response("Not found", { status: 404 });
  const origin = new URL(req.url).origin;
  const host = req.headers.get("x-site-host");
  const home = host ? `${origin}/` : `${origin}/s/${d.org.slug}`;
  const urls = [home, ...d.listings.map((l) => `${origin}/l/${d.org.slug}/${l.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("")}</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
