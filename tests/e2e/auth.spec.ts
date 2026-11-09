import { test, expect, signIn, signUpNewAccount } from "./fixtures";

test("protected routes redirect to sign-in", async ({ page }) => {
  await page.goto("/app/settings/users");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong password shows an inline error", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill("admin@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
});

test("password sign-in lands on the overview, sign-out returns to login", async ({ page }) => {
  await signIn(page, "admin@example.com");
  await expect(page.getByRole("heading", { name: /^Hi, Avery/ })).toBeVisible();
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("magic link sign-in via the mock email outbox", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Email link" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("pm@example.com");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto("/dev/outbox");
  const msg = page.getByTestId("outbox-message").filter({ hasText: "pm@example.com" }).first();
  await msg.getByTestId("outbox-link").first().click();
  await page.waitForURL("**/app/overview");
  await expect(page.getByRole("heading", { name: /^Hi, Priya/ })).toBeVisible();
});

test("signup creates a workspace with the user as Admin", async ({ page }) => {
  const email = `owner-${Date.now()}@example.org`;
  await signUpNewAccount(page, { name: "Sam Starter", org: "Starter Rentals LLC", email, password: "correct-horse-battery" });
  await expect(page.getByRole("heading", { name: "Let's set up Starter Rentals LLC" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup for now" }).click();
  await page.waitForURL("**/app/overview");
  await expect(page.getByText("This is your home page for Starter Rentals LLC.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
});
