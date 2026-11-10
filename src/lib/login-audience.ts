/**
 * Which sign-in screen a link should show. The heading must match the button that sent
 * someone here: "Owner portal" never lands on "Resident portal".
 *
 * The callback path wins over a generic portal=1, because older owner links used portal=1
 * together with callbackUrl=/portal/owner.
 */
export type LoginAudience = "staff" | "invited" | "resident" | "owner" | "vendor";

export function loginAudience(input: { portal?: string; invited?: string; callbackUrl?: string }): LoginAudience {
  if (input.invited === "1") return "invited";
  const path = input.callbackUrl?.startsWith("/") ? input.callbackUrl.split("?")[0]! : "";
  if (path === "/portal/owner" || path.startsWith("/portal/owner/")) return "owner";
  if (path === "/portal/tenant" || path.startsWith("/portal/tenant/")) return "resident";
  if (input.portal === "owner") return "owner";
  if (input.portal === "vendor") return "vendor";
  if (input.portal === "resident" || input.portal === "tenant" || input.portal === "1") return "resident";
  return "staff";
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
