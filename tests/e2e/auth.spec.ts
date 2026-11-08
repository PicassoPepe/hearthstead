import { test, expect, signIn } from "./fixtures";

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
  await expect(page.getByRole("heading", { name: /Good to see you, Avery/ })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /Good to see you, Priya/ })).toBeVisible();
});

test("signup creates a workspace with the user as Admin", async ({ page }) => {
  const email = `owner-${Date.now()}@example.org`;
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Your name" }).fill("Sam Starter");
  await page.getByRole("textbox", { name: "Company name" }).fill("Starter Rentals LLC");
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL("**/app/setup");
  await expect(page.getByRole("heading", { name: "Let's set up Starter Rentals LLC" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup for now" }).click();
  await page.waitForURL("**/app/overview");
  await expect(page.getByText("Here's what's happening at Starter Rentals LLC.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();
});
