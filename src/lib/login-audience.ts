/**
 * Which sign-in screen a link should show. The heading must match the button that sent
 * someone here: "Owner portal" never lands on "Resident portal".
 *
 * The callback path wins over a generic portal=1, because older owner links used portal=1
 * together with callbackUrl=/portal/owner.
 */
export type LoginAudience = "staff" | "invited" | "resident" | "owner" | "vendor";

/** Path (and query) from a relative callback or an absolute one Auth.js puts on /login. */
export function callbackTarget(callbackUrl?: string): string {
  if (!callbackUrl) return "";
  try {
    const u = new URL(callbackUrl, "http://local");
    if (!u.pathname.startsWith("/") || u.pathname.startsWith("//")) return "";
    return u.pathname + u.search;
  } catch {
    return "";
  }
}

export function callbackPath(callbackUrl?: string): string {
  return callbackTarget(callbackUrl).split("?")[0] ?? "";
}

export function loginAudience(input: { portal?: string; invited?: string; callbackUrl?: string }): LoginAudience {
  if (input.invited === "1") return "invited";
  const path = callbackPath(input.callbackUrl);
  // The destination wins over portal=1. Owner links used to be portal=1 plus /portal/owner,
  // and that page said "Resident portal".
  if (path === "/portal/owner" || path.startsWith("/portal/owner/")) return "owner";
  if (path === "/portal/vendor" || path.startsWith("/portal/vendor/")) return "vendor";
  if (path === "/portal/tenant" || path.startsWith("/portal/tenant/")) return "resident";
  if (input.portal === "owner") return "owner";
  if (input.portal === "vendor") return "vendor";
  if (input.portal === "resident" || input.portal === "tenant" || input.portal === "1") return "resident";
  return "staff";
}

/**
 * Where sign-in should land. /portal/vendor is not a page of its own — vendors use Invoices —
 * so a callback to it must not 404.
 */
export function loginDestination(callbackUrl: string | undefined, audience: LoginAudience): string {
  const path = callbackPath(callbackUrl);
  if (path === "/portal/vendor" || path.startsWith("/portal/vendor/")) return "/app/invoices";
  const target = callbackTarget(callbackUrl);
  if (target && path !== "/app/overview") return target;
  if (audience === "owner") return "/portal/owner";
  if (audience === "resident") return "/portal/tenant";
  if (audience === "vendor") return "/app/invoices";
  return "/app/overview";
}

export const LOGIN_COPY: Record<LoginAudience, { title: string; blurb: string }> = {
  staff: { title: "Welcome back", blurb: "Sign in to manage your properties." },
  invited: { title: "Accept your invitation", blurb: "Sign in with an email link to join your team." },
  resident: { title: "Resident portal", blurb: "Sign in to pay rent, request a repair, and message your manager." },
  owner: { title: "Owner portal", blurb: "Sign in to see your properties, statements, and messages." },
  vendor: { title: "Vendor portal", blurb: "Sign in to see your work orders and submit invoices." },
};

/** Login query that keeps the heading and the destination in agreement. */
export function portalLoginQuery(audience: "resident" | "owner" | "vendor", callbackUrl: string) {
  return `/login?portal=${audience}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
