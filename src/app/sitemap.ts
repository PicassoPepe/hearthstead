import type { MetadataRoute } from "next";
import { adminDb } from "@/server/db";
import { siteUrl } from "@/lib/seo/site";
import { MARKETING_PATHS } from "@/lib/seo/paths";

export const dynamic = "force-dynamic";

/**
 * Marketing pages, plus company websites that don't have their own domain (those list themselves
 * on their own domain, so the canonical address wins). Never anything private.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const out: MetadataRoute.Sitemap = MARKETING_PATHS.map((p) => ({ url: `${base}${p === "/" ? "/" : p}`, lastModified: now, changeFrequency: p === "/" || p === "/pricing" ? "weekly" : "monthly", priority: p === "/" ? 1 : 0.7 }));
  const sites = await adminDb.website.findMany({ where: { live: true, publishedAt: { not: null }, customDomain: null }, select: { organizationId: true, publishedAt: true } }).catch(() => []);
  const orgs = await adminDb.organization.findMany({ where: { id: { in: sites.map((s) => s.organizationId) }, deletedAt: null, suspendedAt: null, isSandbox: false }, select: { id: true, slug: true } }).catch(() => []);
  for (const o of orgs) out.push({ url: `${base}/s/${o.slug}`, lastModified: sites.find((s) => s.organizationId === o.id)?.publishedAt ?? now, changeFrequency: "weekly", priority: 0.5 });
  return out;
}
