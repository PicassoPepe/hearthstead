import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RULES, RateLimited, blocked, clear, clientIp, fail, hit, resetMemoryLimits, setClock } from "@/server/auth/rate-limit";

let now = 1_700_000_000_000;
beforeEach(() => {
  delete process.env.REDIS_URL; // in-process store
  resetMemoryLimits();
  setClock(() => now);
});
afterEach(() => setClock(() => Date.now()));

describe("sign-in rate limits", () => {
  it("allows up to the limit from one address, then blocks until the window passes", async () => {
    for (let i = 0; i < RULES.loginIp.limit; i++) await hit("loginIp", "203.0.113.9");
    await expect(hit("loginIp", "203.0.113.9")).rejects.toBeInstanceOf(RateLimited);
    await expect(hit("loginIp", "198.51.100.1")).resolves.toBeUndefined(); // other addresses unaffected
    now += RULES.loginIp.windowSec * 1000 + 1;
    await expect(hit("loginIp", "203.0.113.9")).resolves.toBeUndefined();
  });

  it("locks an account after repeated wrong passwords; a success clears it", async () => {
    const email = "Owner@Example.com";
    for (let i = 0; i < RULES.loginFailEmail.limit - 1; i++) await fail("loginFailEmail", email);
    expect(await blocked("loginFailEmail", email)).toBe(false);
    await clear("loginFailEmail", "owner@example.com"); // case-insensitive
    expect(await blocked("loginFailEmail", email)).toBe(false);
    for (let i = 0; i < RULES.loginFailEmail.limit; i++) await fail("loginFailEmail", email);
    expect(await blocked("loginFailEmail", "owner@example.com")).toBe(true);
    now += RULES.loginFailEmail.windowSec * 1000 + 1;
    expect(await blocked("loginFailEmail", email)).toBe(false);
  });

  it("limits email links per address and per email, and two-factor codes per user", async () => {
    for (let i = 0; i < RULES.magicEmail.limit; i++) await hit("magicEmail", "a@b.c");
    await expect(hit("magicEmail", "a@b.c")).rejects.toThrow(/Too many tries/);
    for (let i = 0; i < RULES.totpUser.limit; i++) await hit("totpUser", "user_1");
    await expect(hit("totpUser", "user_1")).rejects.toBeInstanceOf(RateLimited);
  });

  it("reads the visitor's address from the proxy header", () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(h({}))).toBe("local");
    expect(clientIp(h({ "x-forwarded-for": "127.0.0.1" }))).toBe("local");
    expect(clientIp(h({ "x-forwarded-for": "::1" }))).toBe("local");
    expect(clientIp(h({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe("local");
  });
});
