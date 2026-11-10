import { describe, expect, it } from "vitest";
import { loginAudience, portalLoginQuery } from "@/lib/login-audience";

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

  it("builds a login link whose audience matches the destination", () => {
    expect(portalLoginQuery("owner", "/portal/owner")).toBe("/login?portal=owner&callbackUrl=%2Fportal%2Fowner");
    expect(portalLoginQuery("resident", "/portal/tenant/pay")).toBe("/login?portal=resident&callbackUrl=%2Fportal%2Ftenant%2Fpay");
  });
});
