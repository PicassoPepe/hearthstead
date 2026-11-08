import AxeBuilder from "@axe-core/playwright";
import { test, expect, signIn } from "./fixtures";

const PAGES = ["/app/overview", "/app/settings", "/app/settings/users", "/app/settings/late-fees", "/app/rentals", "/app/rentals/units", "/app/rentals/portfolios", "/app/people/owners", "/app/files?tab=import", "/app/notes", "/app/leasing", "/app/leasing?tab=expiring", "/app/people/tenants", "/app/accounting", "/app/accounting/journal-entries", "/app/accounting/payments", "/app/settings/payments", "/app/tasks", "/app/tasks?view=board", "/app/people/vendors", "/app/settings/maintenance"];

test("login page has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/login");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`key app pages have no WCAG A/AA violations (${theme})`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, "admin@example.com");
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });
}

test("property detail tabs and the New Property wizard have no WCAG A/AA violations", async ({ page }) => {
  await signIn(page, "admin@example.com");
  await page.goto("/app/rentals");
  await page.getByRole("link", { name: "Maple Court" }).click();
  await page.waitForURL(/\/app\/rentals\/c/);
  const base = page.url().split("?")[0];
  for (const tab of ["overview", "owners", "notes", "files", "settings"]) {
    await page.goto(`${base}?tab=${tab}`);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${tab} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
  await page.goto("/app/rentals");
  await page.getByRole("link", { name: "Add property" }).first().click();
  await page.getByRole("dialog", { name: "New property" }).waitFor();
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("lease detail tabs and the New Lease wizard have no WCAG A/AA violations", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/leasing");
  await page.getByRole("link", { name: /Maple Court · 104/ }).click();
  await page.waitForURL(/\/app\/leasing\/c/);
  const base = page.url().split("?")[0];
  for (const tab of ["overview", "transactions", "rent", "tenants", "settings"]) {
    await page.goto(`${base}?tab=${tab}`);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${tab} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
  await page.goto("/app/leasing");
  await page.getByRole("link", { name: "New lease" }).click();
  await page.getByRole("dialog", { name: "New lease" }).waitFor();
  const r = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("tenant portal pages have no WCAG A/AA violations (mobile)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?portal=1");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("tenant@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/tenant");
  for (const path of ["/portal/tenant/requests", "/portal/tenant/requests/new", "/portal/tenant", "/portal/tenant/pay", "/portal/tenant/autopay", "/portal/tenant/methods", "/portal/tenant/history", "/portal/tenant/insurance", "/portal/tenant/documents"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("task detail and inspection checklist have no WCAG A/AA violations", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks");
  for (const q of ["Move-out inspection", "Dishwasher not draining"]) {
    await page.goto("/app/tasks");
    await page.getByRole("textbox", { name: "Search Tasks" }).fill(q);
    await page.getByRole("link", { name: new RegExp(q) }).first().click();
    await page.waitForURL(/\/app\/tasks\/c/);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveTitle(/\S/); // metadata streams in after client navigation
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${q} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("everything is reachable by keyboard with visible focus", async ({ page }) => {
  await signIn(page, "admin@example.com");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  // Focus outline is visible on a focused button.
  await page.getByRole("button", { name: "Create new" }).focus();
  const outline = await page.getByRole("button", { name: "Create new" }).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("mobile (360px): navigation drawer works and nothing scrolls horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, "admin@example.com");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.waitForURL("**/app/settings");
  await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
});
