import { describe, expect, it } from "vitest";
import { loginAudience, loginDestination, portalLoginQuery } from "@/lib/login-audience";

describe("login audience", () => {
  it("matches the button that sent someone here", () => {
    expect(loginAudience({})).toBe("staff");
    expect(loginAudience({ invited: "1" })).toBe("invited");
    expect(loginAudience({ portal: "1" })).toBe("resident");
    expect(loginAudience({ portal: "resident" })).toBe("resident");
    expect(loginAudience({ portal: "owner" })).toBe("owner");
    expect(loginAudience({ portal: "vendor" })).toBe("vendor");
  });

  it("does not call the owner portal a resident portal", () => {
    // Older owner links used portal=1 plus an owner callback.
    expect(loginAudience({ portal: "1", callbackUrl: "/portal/owner" })).toBe("owner");
    expect(loginAudience({ portal: "1", callbackUrl: "/portal/owner/statements" })).toBe("owner");
    expect(loginAudience({ callbackUrl: "/portal/owner" })).toBe("owner");
    expect(loginAudience({ portal: "1", callbackUrl: "/portal/tenant/pay" })).toBe("resident");
  });

  it("follows the callback even when the link still says portal=1", () => {
    // Live subscriber site: Owner login → /login?portal=1&callbackUrl=%2Fportal%2Fowner
    expect(loginAudience({ portal: "1", callbackUrl: "/portal/owner" })).toBe("owner");
    expect(loginAudience({ portal: "1", callbackUrl: "https://deedwood.com/portal/owner" })).toBe("owner");
    expect(loginAudience({ portal: "1", callbackUrl: "https://www.deedwood.com/portal/owner" })).toBe("owner");
    // Signed-out /portal/owner used to land on plain /login?callbackUrl=/portal/owner ("Welcome back").
    expect(loginAudience({ callbackUrl: "/portal/owner" })).toBe("owner");
    expect(loginAudience({ callbackUrl: "https://deedwood.com/portal/owner" })).toBe("owner");
    expect(loginAudience({ portal: "1", callbackUrl: "https://deedwood.com/portal/tenant/pay" })).toBe("resident");
    expect(loginAudience({ callbackUrl: "/portal/vendor" })).toBe("vendor");
    expect(loginAudience({ portal: "1", callbackUrl: "https://deedwood.com/portal/vendor" })).toBe("vendor");
  });

  it("sends each audience to its portal, and never to the missing /portal/vendor page", () => {
    expect(loginDestination("/portal/owner", "owner")).toBe("/portal/owner");
    expect(loginDestination("https://deedwood.com/portal/owner", "owner")).toBe("/portal/owner");
    expect(loginDestination(undefined, "resident")).toBe("/portal/tenant");
    expect(loginDestination("/portal/vendor", "vendor")).toBe("/app/invoices");
    expect(loginDestination("https://deedwood.com/portal/vendor", "vendor")).toBe("/app/invoices");
    expect(loginDestination(undefined, "vendor")).toBe("/app/invoices");
    expect(loginDestination(undefined, "staff")).toBe("/app/overview");
  });

  it("builds a login link whose audience matches the destination", () => {
    expect(portalLoginQuery("owner", "/portal/owner")).toBe("/login?portal=owner&callbackUrl=%2Fportal%2Fowner");
    expect(portalLoginQuery("resident", "/portal/tenant/pay")).toBe("/login?portal=resident&callbackUrl=%2Fportal%2Ftenant%2Fpay");
  });
});
