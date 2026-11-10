import { describe, expect, it } from "vitest";
import { wwwRedirectUrl } from "@/lib/www-redirect";

const env = { SITE_URL: "https://deedwood.com", AUTH_URL: "https://deedwood.com" };

describe("www to apex", () => {
  it("sends www.deedwood.com to the apex and keeps the path", () => {
    expect(wwwRedirectUrl("www.deedwood.com", "/login", "?portal=1", env)).toBe("https://deedwood.com/login?portal=1");
    expect(wwwRedirectUrl("www.deedwood.com:443", "/", "", env)).toBe("https://deedwood.com/");
    expect(wwwRedirectUrl("WWW.Deedwood.com", "/pricing", "", env)).toBe("https://deedwood.com/pricing");
  });

  it("leaves the apex, workers.dev, and a company's own www alone", () => {
    expect(wwwRedirectUrl("deedwood.com", "/", "", env)).toBeNull();
    expect(wwwRedirectUrl("deedwood.deedwood.workers.dev", "/", "", env)).toBeNull();
    expect(wwwRedirectUrl("www.maplecourt.com", "/", "", env)).toBeNull();
    expect(wwwRedirectUrl("localhost:3000", "/", "", { AUTH_URL: "http://localhost:3000" })).toBeNull();
  });
});
