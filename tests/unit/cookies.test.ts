import { describe, expect, it } from "vitest";
import { cookieOptions, shouldUseSecureCookies } from "@/lib/cookies";

describe("cookie helper", () => {
  it.each([
    [{ AUTH_URL: "https://app.deedwood.com", NODE_ENV: "production" }, true],
    [{ AUTH_URL: "https://staging.example.org", NODE_ENV: "development" }, true],
    [{ AUTH_URL: "http://127.0.0.1:3000", NODE_ENV: "production" }, false], // one-click local install
    [{ AUTH_URL: "http://localhost:3000", NODE_ENV: "development" }, false],
    [{ NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "test" }, false],
  ])("secure flag for %j → %s", (env, secure) => {
    expect(shouldUseSecureCookies(env)).toBe(secure);
    expect(cookieOptions({}, env).secure).toBe(secure);
  });

  it("is always httpOnly + SameSite=Lax with a path", () => {
    const o = cookieOptions({ path: "/apply", maxAge: 60 }, { AUTH_URL: "https://x.test" });
    expect(o).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/apply", maxAge: 60 });
    expect(cookieOptions({}, {}).path).toBe("/");
    expect(cookieOptions({ sameSite: "strict" }, {}).sameSite).toBe("strict");
    expect("maxAge" in cookieOptions({}, {})).toBe(false);
  });
});
