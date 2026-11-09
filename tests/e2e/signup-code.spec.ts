import { test, expect } from "./fixtures";

test("sign up with a text-message code; a wrong code is refused; the email is confirmed later", async ({ page }) => {
  const email = `sms-${Date.now()}@example.org`;
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Your name" }).fill("Tex Texter");
  await page.getByRole("textbox", { name: "Company name" }).fill("Text Rentals");
  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("texting-password-1");
  await page.getByText("Text message", { exact: true }).click();
  await page.getByRole("textbox", { name: "Mobile number" }).fill("(502) 555-0142");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/We texted a 6-digit code to •••-•••-0142/)).toBeVisible();
  const code = /(\d{6})/.exec((await page.getByTestId("test-code").textContent()) ?? "")![1]!;

  await page.getByRole("textbox", { name: "6-digit code" }).fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page.getByText(/That code isn't right\. 4 tries left/)).toBeVisible();

  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.waitForURL("**/app/setup");
  // Texted sign-ups still confirm their email with a link.
  await expect(page.getByTestId("verify-email-banner")).toBeVisible();
  await page.goto("/dev/outbox");
  await page.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "Confirm your email" }).first().getByTestId("outbox-link").first().click();
  await expect(page.getByRole("heading", { name: "Email confirmed — thank you!" })).toBeVisible();
});

test("an email that already has an account is told to sign in", async ({ page }) => {
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Your name" }).fill("Avery Again");
  await page.getByRole("textbox", { name: "Company name" }).fill("Again Co");
  await page.getByRole("textbox", { name: "Work email" }).fill("admin@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("whatever-password-1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Already registered — sign in instead.")).toBeVisible();
});
