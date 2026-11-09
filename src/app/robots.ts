import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/site";

/** Public pages may be crawled; anything private never. (Company websites on their own addresses get their own robots.txt.) */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app/", "/portal/", "/admin", "/api/", "/dev/", "/sign/", "/apply/", "/login", "/signup", "/select-org", "/suspended"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
