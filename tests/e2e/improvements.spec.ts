import { test, expect, signIn, stubMapTiles } from "./fixtures";
import type { Page } from "@playwright/test";

// A tiny valid PNG (1×1) for upload tests.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function passwordSignIn(page: Page, email: string, landing: string) {
  await page.goto(`/login?portal=1&callbackUrl=${encodeURIComponent(landing)}`);
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${landing}`);
}

test("signup → setup wizard → company details → sample data sandbox", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Your name" }).fill("Dana Newco");
  await page.getByRole("textbox", { name: "Company name" }).fill("Newco Rentals");
  await page.getByRole("textbox", { name: "Work email" }).fill(`dana.${Date.now()}@example.com`);
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!xyz");
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL("**/app/setup", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Let's set up Newco Rentals" })).toBeVisible();
  await page.getByRole("textbox", { name: "Office phone" }).fill("312-555-0100");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Add your properties" })).toBeVisible();
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.waitForURL("**/app/overview?welcome=sample", { timeout: 120_000 });
  await expect(page.getByText("You're exploring sample data.")).toBeVisible();
  await page.goto("/app/rentals");
  await expect(page.getByRole("link", { name: "Sandbox Apartments" }).first()).toBeVisible();
});

test("property photos: upload, cover, shown on the public listing site", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/rentals");
  await page.getByRole("link", { name: "Maple Court" }).first().click();
  await page.getByRole("link", { name: /^Photos/ }).click();
  await page.waitForURL(/tab=photos/);
  await expect(page.getByTestId("photo-grid").locator("li").first()).toBeVisible();
  const before = await page.getByTestId("photo-grid").locator("li").count();
  await page.locator('input[type="file"]').setInputFiles({ name: "lobby.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("1 photo added")).toBeVisible();
  await expect(page.getByTestId("photo-grid").locator("li")).toHaveCount(before + 1);
  await page.getByRole("button", { name: `Make photo ${before + 1} the cover` }).click();
  await expect(page.getByText("Cover photo updated")).toBeVisible();
  await page.goto("/l/maple-main");
  await expect(page.locator('img[src^="/api/images/"]').first()).toBeVisible();
});

test("notification bell: a tenant's portal message notifies staff", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const tenant = await browser.newPage();
  await passwordSignIn(tenant, "tenant@example.com", "/portal/tenant");
  await tenant.goto("/portal/tenant/messages");
  await tenant.waitForLoadState("networkidle");
  const text = `Quick question ${Date.now() % 10000}`;
  await tenant.getByRole("textbox", { name: "Add a message" }).fill(text);
  await tenant.getByRole("button", { name: "Send" }).click();
  await expect(tenant.getByText("Message sent")).toBeVisible();
  await tenant.close();

  await signIn(page, "admin@example.com", "/app/overview");
  await page.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
  const item = page.getByTestId("notification-list").getByRole("menuitem").filter({ hasText: text });
  await expect(item).toBeVisible();
  await item.click();
  await page.waitForURL(/\/app\/communications\?c=/);
});

test("calendar shows the month and agenda; keys & spaces assign a parking space", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByTestId("agenda")).toBeVisible();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);

  await page.goto("/app/rentals/keys");
  await page.getByRole("button", { name: "Add key or space" }).click();
  const dlg = page.getByRole("dialog", { name: "Add key or space" });
  await dlg.getByRole("combobox", { name: "Type" }).selectOption("PARKING");
  const label = `E2E-${Date.now() % 100000}`;
  await dlg.getByRole("textbox", { name: "Label" }).fill(label);
  await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Maple Court" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Added")).toBeVisible();
  const card = page.getByTestId("key-items").locator("li").filter({ hasText: label });
  await card.getByRole("button", { name: "Assign…" }).click();
  await page.getByRole("dialog", { name: `Assign ${label}` }).getByRole("button", { name: "Assign" }).click();
  await expect(card.getByText(/Held by/)).toBeVisible();
});

test("rent increase: preview then apply to one lease", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/leasing/rent-increase");
  await page.getByRole("combobox", { name: "Property" }).selectOption({ label: "Oak Terrace Apartments" });
  await page.getByRole("checkbox", { name: "Select all shown leases" }).check();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("increase-preview")).toContainText("→");
  await page.getByRole("button", { name: /^Apply to [1-9]/ }).click();
  await expect(page.getByText(/Rent updated on \d+ leases?/)).toBeVisible();
});

test("budgets: create from last year's actuals and see budget vs actual", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/budgets");
  await page.getByRole("button", { name: "New budget" }).click();
  const dlg = page.getByRole("dialog", { name: "New budget" });
  const name = `E2E budget ${Date.now() % 100000}`;
  await dlg.getByRole("textbox", { name: "Name" }).fill(name);
  await dlg.getByRole("textbox", { name: "Year" }).fill("2026");
  await dlg.getByRole("button", { name: "Create budget" }).click();
  await page.waitForURL(/\/app\/accounting\/budgets\/.+tab=edit/);
  await page.getByRole("textbox", { name: "Repairs & Maintenance, Jan" }).fill("1200");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved")).toBeVisible();
  await page.getByRole("link", { name: "Budget vs actual" }).click();
  await expect(page.getByRole("rowheader", { name: /Repairs & Maintenance/ })).toBeVisible();
});

test("vendor submits an invoice; staff approve it into a bill; owner approves a large bill", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const vendor = await browser.newPage();
  await signIn(vendor, "vendor@example.com", "/app/tasks");
  await vendor.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" }).click().catch(async () => vendor.goto("/app/invoices"));
  await vendor.waitForURL("**/app/invoices");
  await vendor.waitForLoadState("networkidle");
  const num = `E2E-${Date.now() % 100000}`;
  await vendor.getByRole("combobox", { name: "Work order" }).selectOption("");
  await vendor.getByRole("textbox", { name: "Invoice #" }).fill(num);
  await vendor.getByRole("textbox", { name: "Amount" }).fill("185");
  await vendor.getByRole("textbox", { name: "Work performed" }).fill("Replaced shutoff valve");
  await vendor.getByRole("button", { name: "Submit invoice" }).click();
  await expect(vendor.getByTestId("vendor-invoices")).toContainText(`#${num}`);
  await vendor.close();

  await signIn(page, "admin@example.com", "/app/accounting/bills");
  const row = page.getByTestId("invoices-to-review").locator("li").filter({ hasText: `#${num}` });
  await row.getByRole("button", { name: "Approve…" }).click();
  await page.getByRole("button", { name: "Approve & create bill" }).click();
  await expect(page.getByText("Invoice approved — bill created")).toBeVisible();
  await expect(page.getByTestId("owner-approvals")).toContainText("Gutter replacement");

  const owner = await browser.newPage();
  await passwordSignIn(owner, "owner@example.com", "/portal/owner");
  await owner.getByRole("link", { name: "Review" }).click();
  const pending = owner.getByTestId("pending-approvals").locator("li").filter({ hasText: "Gutter replacement" });
  await pending.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText("Approved — thanks!")).toBeVisible();
  await owner.close();
});

test("year-end close locks and reopens a year", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/close");
  const y = String(new Date().getFullYear() - 1);
  await page.getByRole("button", { name: `Close ${y}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: `Close ${y}` }).click();
  await expect(page.getByText(`${y} closed`, { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`Books are closed through Dec 31, ${y}`))).toBeVisible();
  await page.getByRole("button", { name: `Reopen ${y}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: `Reopen ${y}` }).click();
  await expect(page.getByText(`${y} reopened`, { exact: true })).toBeVisible();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("bottom tab bar, quick actions and card lists", async ({ page }) => {
    await signIn(page, "admin@example.com", "/app/overview");
    const bar = page.getByRole("navigation", { name: "Quick navigation" });
    await expect(bar).toBeVisible();
    await bar.getByRole("link", { name: "Tasks" }).click();
    await page.waitForURL("**/app/tasks");
    await expect(page.getByTestId("table-cards")).toBeVisible();
    await bar.getByRole("button", { name: "Quick actions" }).click();
    await page.getByRole("dialog", { name: "Quick actions" }).getByRole("link", { name: "New task or request" }).click();
    await expect(page.getByRole("dialog", { name: /New task/ })).toBeVisible();
  });
});

test("land records: staff see the county record and attach a deed; the owner sees both in their portal", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "/app/rentals");
  await page.getByRole("link", { name: "Cedar Duplex" }).first().click();
  await page.getByRole("link", { name: "Land records" }).click();
  const panel = page.getByTestId("land-record");
  await expect(panel.getByText("Owner of record", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Owner of record matches the owners on file/)).toBeVisible();
  await expect(panel.getByRole("img", { name: /Map of the parcel/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Document type" }).selectOption("Deed");
  await page.locator('input[type="file"][accept^="application/pdf"]').setInputFiles({ name: "cedar-deed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") });
  await expect(page.getByText("Document attached")).toBeVisible();
  await expect(page.getByTestId("land-docs")).toContainText("cedar-deed.pdf");

  const owner = await browser.newPage();
  await stubMapTiles(owner);
  await passwordSignIn(owner, "owner@example.com", "/portal/owner");
  await owner.goto("/portal/owner/properties");
  await owner.getByRole("link", { name: "Cedar Duplex" }).click();
  await expect(owner.getByRole("heading", { name: "County land record" })).toBeVisible();
  await expect(owner.getByTestId("land-docs")).toContainText("cedar-deed.pdf");
  await expect(owner.getByRole("button", { name: /Refresh from county/ })).toHaveCount(0); // read-only
  await owner.close();
});
