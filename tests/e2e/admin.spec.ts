import { execSync } from "node:child_process";
import { test, expect, signIn } from "./fixtures";
import { totp } from "../../src/server/platform/totp";

test("staff, tenants and owners can't open the owner console", async ({ page }) => {
  await signIn(page, "admin@example.com");
  // Same session cookies, without loading the 404 page in the browser.
  expect((await page.request.get("/admin")).status()).toBe(404);
  expect((await page.request.get("/admin/orgs")).status()).toBe(404);
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/admin");
  await page.waitForURL(/\/login/);
});

test("platform owner: sign in with a code, find a company, view as a member, stop", async ({ page }) => {
  const o = JSON.parse(execSync("pnpm -s tsx tests/e2e/helpers/make-owner.ts", { encoding: "utf8" }).trim().split("\n").pop()!) as { email: string; password: string; secret: string };
  await page.goto("/login?callbackUrl=/admin");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email" }).fill(o.email);
  await page.locator("input[type=password]").fill(o.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter the 6-digit code from your authenticator app.")).toBeVisible();
  await page.getByRole("textbox", { name: "Authentication code" }).fill(totp(o.secret));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Owner console" })).toBeVisible();

  await page.getByRole("navigation", { name: "Owner console" }).getByRole("link", { name: "Companies" }).click();
  await page.getByRole("textbox", { name: "Search companies" }).fill("Maple");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: "Maple & Main Property Co." }).click();
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "admin@example.com" });
  await row.getByRole("button", { name: "View as" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: "Reason" }).fill("Helping with a support request");
  await dlg.getByRole("textbox", { name: "Two-factor code" }).fill(totp(o.secret));
  await dlg.getByRole("button", { name: "View as" }).click();
  await page.waitForURL("**/app/overview");
  await expect(page.getByTestId("impersonation-banner")).toContainText("Viewing as");
  await page.getByRole("button", { name: "Stop viewing" }).click();
  await page.waitForURL(/\/admin\/orgs\//);

  await page.getByRole("navigation", { name: "Owner console" }).getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: "impersonation.started" }).first()).toBeVisible();
  await page.getByRole("navigation", { name: "Owner console" }).getByRole("link", { name: "System health" }).click();
  await expect(page.getByTestId("health-check").first()).toBeVisible();
});
