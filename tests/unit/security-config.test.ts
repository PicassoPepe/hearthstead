import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
// @ts-expect-error — plain .mjs script without types
import { checkEnv } from "../../scripts/check-env.mjs";

describe("security headers", () => {
  it("sends the standard set", () => {
    const h = Object.fromEntries(securityHeaders().map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
  });
  it("CSP: self by default, no framing, maps and Stripe allowed, eval only in development", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("https://tile.openstreetmap.org");
    expect(csp).toContain("https://js.stripe.com");
    expect(csp).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });
});

describe("check-env", () => {
  const good = { AUTH_SECRET: "k".repeat(16) + "Zq8!xP2mV7rT4wY9", AUTH_URL: "https://app.deedwood.test", DATABASE_ADMIN_URL: "postgresql://u:Str0ngGenerated@db.internal:5432/deedwood" };
  it("passes good settings", () => expect(checkEnv(good).errors).toEqual([]));
  it.each([
    [{ AUTH_SECRET: "dev-only-change-me-dev-only-change-me" }, /AUTH_SECRET/],
    [{ AUTH_SECRET: "short" }, /AUTH_SECRET/],
    [{ AUTH_URL: "http://app.deedwood.test" }, /https/],
    [{ AUTH_URL: undefined }, /AUTH_URL/],
    [{ DATABASE_ADMIN_URL: undefined }, /Postgres/],
    [{ STRIPE_SECRET_KEY: "sk_live_abc123" }, /live key/],
    [{ TWILIO_AUTH_TOKEN: "changeme" }, /placeholder/],
  ])("rejects %j", (patch, msg) => {
    const r = checkEnv({ ...good, ...patch });
    expect(r.errors.join(" ")).toMatch(msg);
  });
  it("allows a live Stripe key only once approved", () => {
    expect(checkEnv({ ...good, STRIPE_SECRET_KEY: "sk_live_abc123", STRIPE_LIVE_APPROVED: "1" }).errors).toEqual([]);
  });
});
