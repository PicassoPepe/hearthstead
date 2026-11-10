/** Apex hostname from SITE_URL or AUTH_URL. `www.` on that value is stripped. Local hosts are ignored. */
export function apexHostname(env: { SITE_URL?: string; AUTH_URL?: string }): string | null {
  const raw = env.SITE_URL || env.AUTH_URL;
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/**
 * 301 target when the public host is www.<apex>. Other www hosts (a company's own domain)
 * stay where they are.
 */
export function wwwRedirectUrl(hostHeader: string, pathname: string, search: string, env: { SITE_URL?: string; AUTH_URL?: string }): string | null {
  const apex = apexHostname(env);
  if (!apex) return null;
  const host = hostHeader.split(",")[0]?.trim().split(":")[0]?.toLowerCase().replace(/\.$/, "") ?? "";
  if (host !== `www.${apex}`) return null;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `https://${apex}${path}${search}`;
}
