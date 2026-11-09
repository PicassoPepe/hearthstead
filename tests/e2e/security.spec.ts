import { test, expect, signUpNewAccount } from "./fixtures";

test("security headers on the sign-in page", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("default-src 'self'");
});

test("a form post from another website is rejected (CSRF)", async ({ request, baseURL }) => {
  const send = (origin: string) =>
    request.post("/login", { headers: { "Next-Action": "7f00000000000000000000000000000000000000", Origin: origin, "Content-Type": "text/plain;charset=UTF-8" }, data: "[]" });
  // Same site: the request is accepted and only fails because the action doesn't exist.
  expect((await send(baseURL!)).status()).toBe(404);
  // Another site: refused before any action runs.
  expect((await send("https://evil.example")).status()).toBe(500);
});

test("an account locks after repeated wrong passwords", async ({ page }) => {
  const email = `lock-${Date.now()}@example.org`;
  await signUpNewAccount(page, { name: "Lou Lock", org: "Lockout Rentals", email, password: "correct-horse-battery" });
  await page.context().clearCookies();
  await page.goto("/login");
  const pw = page.locator("input[type=password]");
  for (let i = 0; i < 8; i++) {
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await pw.fill(`wrong-password-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
  }
  await pw.fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Too many wrong tries for this account/)).toBeVisible();
});
