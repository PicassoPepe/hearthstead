import { test, expect, signIn } from "./fixtures";

test("reports: P&L by month with drilldown to the general ledger, CSV + AI summary", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/reports");
  await page.getByRole("link", { name: /Profit & loss/ }).click();
  await expect(page.getByRole("heading", { name: "Profit & loss" })).toBeVisible();
  await page.getByRole("combobox", { name: "Columns" }).selectOption("month");
  await expect(page).toHaveURL(/groupBy=month/);
  await expect(page.getByRole("columnheader", { name: "Total" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^profit-loss-.*\.csv$/);
  await page.getByRole("button", { name: "AI summary" }).click();
  await expect(page.getByRole("region", { name: "AI summary" })).toContainText("Total income");
  await page.getByRole("link", { name: "4000 · Rent Income" }).click();
  await expect(page.getByRole("heading", { name: "General ledger" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Account" })).toHaveValue(/.+/);
});

test("reports: rent roll filtered to one property; printable view", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/reports/rent-roll");
  await page.getByRole("combobox", { name: "Properties" }).selectOption({ label: "Maple Court" });
  await expect(page.getByText(/^As of .* · Maple Court$/)).toBeVisible();
  const [print] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "PDF" }).click()]);
  await expect(print.getByRole("heading", { name: "Rent roll" })).toBeVisible();
  await expect(print.getByRole("button", { name: "Print / save as PDF" })).toBeVisible();
});

test("dashboard: widgets render, hide one, reorder by keyboard buttons; layout persists", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/overview");
  await expect(page.getByTestId("widget-rent")).toBeVisible();
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Hide Cash" }).click();
  await page.getByRole("button", { name: "Move Occupancy earlier" }).click();
  await expect(page.getByText("Occupancy moved earlier")).toBeAttached();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("widget-cash")).toHaveCount(0);
  await expect(page.getByTestId("layout-save-state")).toHaveText("Layout saved");
  await page.reload();
  await expect(page.getByTestId("widget-cash")).toHaveCount(0);
  const ids = await page.locator("[data-testid^=widget-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(ids.indexOf("widget-occupancy")).toBeLessThan(ids.indexOf("widget-aging"));
  await page.getByRole("combobox", { name: "View as" }).selectOption({ label: "Bookkeeper" });
  await expect(page.locator("[data-testid^=widget-]").first()).toHaveAttribute("data-testid", "widget-cash");
  await page.getByRole("link", { name: "Open Bills due details" }).click();
  await expect(page.getByRole("heading", { name: "Bills" })).toBeVisible();
});

test("maintenance role sees only the requests and occupancy widgets", async ({ page }) => {
  await signIn(page, "maint@example.com", "/app/overview");
  await expect(page.getByTestId("widget-requests")).toBeVisible();
  await expect(page.getByTestId("widget-pnl")).toHaveCount(0);
});
