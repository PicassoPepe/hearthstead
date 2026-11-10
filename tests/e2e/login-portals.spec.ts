import { test, expect, PASSWORD } from "./fixtures";

test("login headings match the portal the button named", async ({ page }) => {
  await page.goto("/login?portal=owner&callbackUrl=%2Fportal%2Fowner");
  await expect(page.getByRole("heading", { name: "Owner portal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff sign in" })).toBeVisible();

  // Older owner links used the resident flag plus an owner destination.
  await page.goto("/login?portal=1&callbackUrl=%2Fportal%2Fowner");
  await expect(page.getByRole("heading", { name: "Owner portal" })).toBeVisible();

  await page.goto("/login?portal=resident&callbackUrl=%2Fportal%2Ftenant");
  await expect(page.getByRole("heading", { name: "Resident portal" })).toBeVisible();

  await page.goto("/login?portal=1");
  await expect(page.getByRole("heading", { name: "Resident portal" })).toBeVisible();

  await page.goto("/login?portal=vendor");
  await expect(page.getByRole("heading", { name: "Vendor portal" })).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Start your free trial" })).toBeVisible();
});

test("owner, resident and vendor sign-in land on the matching portal", async ({ page }) => {
  await page.goto("/login?portal=owner&callbackUrl=%2Fportal%2Fowner");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/owner");
  await expect(page.getByText(/Owner portal/).first()).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login?portal=resident&callbackUrl=%2Fportal%2Ftenant");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("tenant@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/tenant");
  await expect(page.getByText(/Resident portal|Hi,/).first()).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/login?portal=vendor&callbackUrl=%2Fapp%2Finvoices");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("vendor@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/invoices");
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
});
