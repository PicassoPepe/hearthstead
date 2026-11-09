import type { Page } from "@playwright/test";
import { test, expect, signIn } from "./fixtures";

async function tenantSignIn(page: Page) {
  await page.goto("/login?portal=1");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("tenant@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("landlord pauses a tenant's portal access, the tenant is told, and access comes back", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "/app/people/tenants");
  await page.getByRole("textbox", { name: /Search/ }).fill("tenant@example.com");
  await page.getByRole("row").filter({ hasText: "tenant@example.com" }).getByRole("link").first().click();
  await page.waitForURL(/\/app\/people\/tenants\/[^/?]+/);
  const tenantUrl = page.url();

  await page.getByRole("button", { name: "Pause portal access" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: /Reason/ }).fill("Account under review");
  await dlg.getByRole("button", { name: "Pause access" }).click();
  await expect(page.getByTestId("portal-paused")).toContainText("Account under review");

  const tenant = await (await browser.newContext()).newPage();
  await tenantSignIn(tenant);
  await tenant.waitForURL(/\/portal\/no-access\?paused=1/);
  await expect(tenant.getByRole("heading", { name: "Your portal access is paused" })).toBeVisible();

  await page.goto(tenantUrl);
  await page.getByRole("button", { name: "Turn portal access back on" }).click();
  await expect(page.getByText("Portal access turned back on")).toBeVisible();
  await expect(page.getByTestId("portal-paused")).toHaveCount(0);
  await tenant.goto("/portal/tenant");
  await expect(tenant.getByRole("heading", { name: /^Hi, / })).toBeVisible();
});
