/**
 * Which website (if any) an address belongs to:
 * - the app's own address (AUTH_URL), localhost → none (normal app);
 * - <web name>.<SITES_ROOT_DOMAIN> → that company;
 * - anything else → maybe a company's own domain (looked up).
 */
export type HostMatch = { kind: "app" } | { kind: "slug"; slug: string } | { kind: "custom" };
const RESERVED = new Set(["www", "app", "admin", "api", "mail", "portal", "status"]);

export function siteSlugForHost(host: string, o: { appUrl?: string; rootDomain?: string }): HostMatch {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith(".localhost")) return { kind: "app" };
  let appHost: string | null = null;
  try { appHost = o.appUrl ? new URL(o.appUrl).hostname.toLowerCase() : null; } catch { appHost = null; }
  if (appHost && h === appHost) return { kind: "app" };
  const root = o.rootDomain?.toLowerCase().replace(/^\./, "");
  if (root) {
    if (h === root || h === `www.${root}`) return { kind: "app" };
    if (h.endsWith(`.${root}`)) {
      const sub = h.slice(0, -(root.length + 1));
      return /^[a-z0-9-]{2,63}$/.test(sub) && !RESERVED.has(sub) ? { kind: "slug", slug: sub } : { kind: "app" };
    }
  }
  // Hosting platforms' own addresses (e.g. *.up.railway.app) are the app, not a customer domain.
  if (/\.(up\.railway\.app|onrender\.com|fly\.dev|vercel\.app)$/.test(h)) return { kind: "app" };
  return { kind: "custom" };
}
