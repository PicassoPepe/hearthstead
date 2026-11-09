import { test, expect, signIn } from "./fixtures";

// Discounts here start in 2099 so they never change the demo tenants' balances other tests rely on.

test("owner gives a rent discount with a required reason, sees its history, then stops it", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/money/discounts");
  await expect(page.getByRole("heading", { name: "Discounts & concessions" })).toBeVisible();
  await page.getByRole("button", { name: "Give a discount" }).click();
  const dlg = page.getByRole("dialog", { name: "Give a discount" });
  await dlg.getByRole("combobox", { name: "Lease" }).selectOption({ index: 1 });
  await dlg.getByRole("textbox", { name: "Amount off each charge" }).fill("25");
  await dlg.getByRole("combobox", { name: "How long?" }).selectOption("FOREVER");
  await dlg.getByLabel("Starting").fill("2099-01-01");
  await dlg.getByRole("button", { name: "Give discount" }).click();
  await expect(dlg.getByRole("alert").filter({ hasText: "Choose a reason" })).toBeVisible();

  await dlg.getByRole("combobox", { name: "Reason" }).selectOption("Lease renewal incentive");
  await dlg.getByRole("button", { name: "Give discount" }).click();
  await page.waitForURL(/\/app\/money\/discounts\/[^/]+$/);
  await expect(page.getByTestId("discount-status")).toHaveText("Active");
  await expect(page.getByTestId("discount-history")).toContainText("Created");
  await expect(page.getByText("$25.00 off rent from 2099-01-01, until stopped")).toBeVisible();

  await page.getByRole("button", { name: "Stop this discount" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Reason" }).fill("Renewal fell through");
  await page.getByRole("dialog").getByRole("button", { name: "Stop this discount" }).click();
  await expect(page.getByTestId("discount-status")).toHaveText("Stopped");
  await expect(page.getByTestId("discount-history")).toContainText("Renewal fell through");
});

test("a code made by the owner can be entered by a tenant in their portal", async ({ page, browser }) => {
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await signIn(page, "admin@example.com", "/app/money/discounts");
  await page.getByRole("button", { name: "Give a discount" }).click();
  const dlg = page.getByRole("dialog", { name: "Give a discount" });
  await dlg.getByRole("radio", { name: /A code tenants enter/ }).check();
  await dlg.getByRole("textbox", { name: "Code", exact: true }).fill(code);
  await dlg.getByRole("textbox", { name: "Amount off each charge" }).fill("10");
  await dlg.getByLabel("Starting").fill("2099-01-01");
  await dlg.getByRole("combobox", { name: "Reason" }).selectOption("Referral reward");
  await dlg.getByRole("button", { name: "Give discount" }).click();
  await page.waitForURL(/\/app\/money\/discounts\/[^/]+$/);
  await expect(page.getByText(`Code ${code}`)).toBeVisible();

  const t = await (await browser.newContext()).newPage();
  await t.goto("/login?portal=1");
  await t.getByRole("tab", { name: "Password" }).click();
  await t.getByRole("textbox", { name: "Email" }).fill("tenant@example.com");
  await t.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await t.getByRole("button", { name: "Sign in" }).click();
  await t.waitForURL("**/portal/tenant");
  await t.goto("/portal/tenant/pay");
  await t.getByRole("textbox", { name: "Have a discount code?" }).fill("WRONG-CODE");
  await t.getByRole("button", { name: "Apply code" }).click();
  await expect(t.getByText("That code isn't valid.").first()).toBeVisible();
  await t.getByRole("textbox", { name: "Have a discount code?" }).fill(code.toLowerCase());
  await t.getByRole("button", { name: "Apply code" }).click();
  await expect(t.getByRole("status").filter({ hasText: "Applied: $10.00 off rent" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("discount-history")).toContainText("Code used");
});

test("staff without the Discounts permission can't open the page", async ({ page }) => {
  await signIn(page, "maint@example.com", "/app/overview");
  await page.goto("/app/money/discounts");
  await expect(page.getByText("You don't have access")).toBeVisible();
});
