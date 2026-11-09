import { test, expect, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => signIn(page, "admin@example.com"));

test("two-level sidebar swaps to a section submenu and back", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Rent & Money" }).click();
  await page.waitForURL("**/app/money");
  await expect(nav.getByRole("button", { name: /Rent & Money.*back to all sections/ })).toBeVisible();
  await nav.getByRole("link", { name: "Bills to pay" }).click();
  await page.waitForURL("**/app/accounting/bills");
  await expect(page.getByRole("heading", { name: "Bills to pay", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: /back to all sections/ }).click();
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
});

test("sidebar collapses to icons and remembers it", async ({ page }) => {
  // The preference is saved in the background — wait for that request before reloading.
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/"));
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await saved;
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  const restored = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/app/"));
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await restored;
});

test("command palette searches people and navigates", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search or type a command…");
  await input.fill("Priya");
  const option = page.getByRole("option", { name: /Priya Manager/ });
  await expect(option).toBeVisible();
  await option.click();
  await page.waitForURL("**/app/settings/users?member=*");
  await expect(page.getByRole("heading", { name: "Users & roles" })).toBeVisible();
});

test("command palette jumps to a settings page by keyword", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search or type a command…").fill("grace");
  await page.getByRole("option", { name: /Grace period/ }).click();
  await page.waitForURL("**/app/settings/late-fees");
});

test("Create new → User opens a modal route over the current page and invites", async ({ page }) => {
  await page.goto("/app/settings/users");
  await page.getByRole("button", { name: "Create new" }).click();
  await page.getByRole("menuitem", { name: "User", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/new\/user$/, { timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: "New user" });
  await expect(dialog).toBeVisible();
  // The page underneath is still rendered (and correctly hidden from assistive tech while the modal is open).
  await expect(page.getByRole("heading", { name: "Users & roles", exact: true, includeHidden: true })).toBeAttached();

  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog.getByText("Enter their name")).toBeVisible();

  await dialog.getByRole("textbox", { name: "Full name" }).fill("Nina Newhire");
  await dialog.getByRole("textbox", { name: "Email" }).fill("nina@example.com");
  await dialog.getByRole("combobox", { name: "Role" }).selectOption({ label: "Bookkeeper" });
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent to nina@example.com")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/settings\/users$/);
  await expect(page.getByRole("row", { name: /Nina Newhire/ })).toBeVisible();
});

test("deep-linking /app/new/user renders a full page", async ({ page }) => {
  await page.goto("/app/new/user");
  await expect(page.getByRole("heading", { name: "New user" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("every Create new kind opens a real form (Bill as the example)", async ({ page }) => {
  await page.getByRole("button", { name: "Create new" }).click();
  await page.getByRole("menuitem", { name: "Bill" }).click();
  await expect(page.getByRole("dialog", { name: "New bill" }).getByRole("combobox", { name: "Vendor" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/overview$/);
});

test("org switcher changes the active organization", async ({ page }) => {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Harbor Light Rentals" }).click();
  await expect(page.getByText("This is your home page for Harbor Light Rentals.", { exact: false })).toBeVisible();
  await page.goto("/app/settings/late-fees");
  // Harbor Light overrides grace days to 10; Admin is only a Property Manager there (view-only settings).
  await expect(page.locator('[data-setting="lateFees.graceDays"] input')).toHaveValue("10");
  await expect(page.locator('[data-setting="lateFees.graceDays"]').getByRole("switch")).toHaveCount(0);
  await expect(page.locator('[data-setting="lateFees.graceDays"] input')).toBeDisabled();
  // Switch back: the choice is remembered on the account, and later tests expect Maple & Main.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Maple & Main Property Co." }).click();
  await expect(page.getByText("This is your home page for Maple & Main Property Co.", { exact: false })).toBeVisible();
});
