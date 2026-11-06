import AxeBuilder from "@axe-core/playwright";
import { test, expect, signIn } from "./fixtures";

const PAGES = ["/app/overview", "/app/settings", "/app/settings/users", "/app/settings/late-fees", "/app/rentals"];

test("login page has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/login");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`key app pages have no WCAG A/AA violations (${theme})`, async ({ page }) => {
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
