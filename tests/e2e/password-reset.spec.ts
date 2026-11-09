import { test, expect } from "./fixtures";

test("forgot password → email link → new password works; the link can't be reused", async ({ page }) => {
  const email = `forgot-${Date.now()}@example.org`;
  // A fresh account (sign up), then sign out.
  await page.goto("/signup");
  await page.getByRole("textbox", { name: "Your name" }).fill("Fran Forgot");
  await page.getByRole("textbox", { name: "Company name" }).fill("Forgetful Rentals");
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("original-password-1");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL("**/app/setup");
  await expect(page.getByTestId("verify-email-banner")).toBeVisible();

  // Confirm the email from the outbox.
  await page.goto("/dev/outbox");
  await page.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "Confirm your email" }).first().getByTestId("outbox-link").first().click();
  await expect(page.getByRole("heading", { name: "Email confirmed — thank you!" })).toBeVisible();
  await page.goto("/app/overview");
  await expect(page.getByTestId("verify-email-banner")).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/login/forgot");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.goto("/dev/outbox");
  const link = page.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "Reset your" }).first().getByTestId("outbox-link").first();
  const href = (await link.getAttribute("href"))!;
  await page.goto(href);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("New password").fill("brand-new-password-2");
  await page.getByLabel("Type it again").fill("brand-new-password-2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

  await page.goto(href);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.locator("input[type=password]").fill("brand-new-password-2");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//);
});
