export async function GET(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const origin = new URL(req.url).origin;
  const sitemap = req.headers.get("x-site-host") ? `${origin}/sitemap.xml` : `${origin}/s/${orgSlug}/sitemap.xml`;
  return new Response(`User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /portal/\nDisallow: /admin/\nSitemap: ${sitemap}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
