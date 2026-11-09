import { afterEach, describe, expect, it } from "vitest";
import { captchaSiteKey, setCaptchaFetcher, verifyCaptcha } from "@/server/auth/captcha";

afterEach(() => { delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY; });

describe("captcha (Cloudflare Turnstile)", () => {
  it("is skipped until both keys are set", async () => {
    expect(captchaSiteKey()).toBeNull();
    expect(await verifyCaptcha(undefined)).toBe(true);
    process.env.TURNSTILE_SITE_KEY = "site";
    expect(captchaSiteKey()).toBeNull();
  });
  it("checks the token with Cloudflare and fails closed", async () => {
    process.env.TURNSTILE_SITE_KEY = "site";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(captchaSiteKey()).toBe("site");
    const seen: string[] = [];
    setCaptchaFetcher(async (_u, init) => { seen.push(String(init.body)); return new Response(JSON.stringify({ success: String(init.body).includes("good") })); });
    expect(await verifyCaptcha(null)).toBe(false);
    expect(await verifyCaptcha("good-token", "203.0.113.4")).toBe(true);
    expect(seen.at(-1)).toContain("remoteip=203.0.113.4");
    expect(await verifyCaptcha("bad-token")).toBe(false);
    setCaptchaFetcher(async () => { throw new Error("network down"); });
    expect(await verifyCaptcha("good-token")).toBe(false);
  });
});
