import { test, expect, signIn } from "./fixtures";
import type { Page } from "@playwright/test";

async function tenantSignIn(page: Page) {
  await page.goto("/login?portal=1");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("tenant@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/tenant");
}

test("staff: create a work order from Create new; the vendor is emailed", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks");
  await page.getByRole("button", { name: "Create new" }).click();
  await page.getByRole("menuitem", { name: "Work order" }).click();
  const dlg = page.getByRole("dialog", { name: "New work order" });
  await dlg.getByRole("textbox", { name: "Title" }).fill("Replace kitchen faucet cartridge");
  await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Maple Court" });
  await dlg.getByRole("combobox", { name: "Unit" }).selectOption({ label: "101" });
  await dlg.getByRole("combobox", { name: "Category" }).selectOption("PLUMBING");
  await expect(dlg.getByText(/Suggested for this category: Ace Plumbing/)).toBeVisible();
  await dlg.getByRole("combobox", { name: "Vendor" }).selectOption({ label: "Ace Plumbing" });
  await dlg.getByRole("textbox", { name: "Cost estimate" }).fill("240");
  await expect(dlg.getByRole("checkbox", { name: /Email the work order to Ace Plumbing/ })).toBeChecked();
  await dlg.getByRole("button", { name: "Create work order" }).click();
  await expect(page.getByText(/Work order #\d+ created/)).toBeVisible();

  await page.getByRole("textbox", { name: "Search Tasks" }).fill("faucet cartridge");
  await page.getByRole("link", { name: /Replace kitchen faucet cartridge/ }).click();
  await expect(page.getByText(/Work order emailed to vendor@example.com/)).toBeVisible();
  await page.goto("/dev/outbox");
  await expect(page.getByTestId("outbox-message").filter({ hasText: "Replace kitchen faucet cartridge" }).first()).toContainText("vendor@example.com");
});

test("board: move a card with the keyboard-friendly select (optimistic, persists)", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks?view=board");
  const select = page.getByRole("combobox", { name: /Move #\d+ to/ }).first();
  const label = await select.getAttribute("aria-label");
  await select.selectOption("WAITING");
  await expect(page.getByText(/moved to Waiting/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: label! })).toHaveValue("WAITING");
});

test("tenant request round trip: portal → auto-assigned → staff reply → tenant sees it", async ({ page, browser }) => {
  await tenantSignIn(page);
  await page.goto("/portal/tenant/requests/new");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Choose a category").first()).toBeVisible();
  await page.getByRole("combobox", { name: "What needs fixing?" }).selectOption("PLUMBING");
  await page.getByRole("textbox", { name: "Short summary" }).fill("Shower head leaking");
  await page.getByRole("textbox", { name: "Details" }).fill("Drips all night, getting worse.");
  await page.getByLabel("Photos").setInputFiles({ name: "leak.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex") });
  await page.getByRole("radio", { name: "Yes, you may enter" }).check();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("heading", { name: "Shower head leaking" })).toBeVisible();
  await expect(page.getByText("Request received").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Photo: leak.png/ })).toBeVisible();
  const url = page.url();

  const staff = await browser.newPage();
  await signIn(staff, "admin@example.com", "/app/tasks");
  await staff.getByRole("textbox", { name: "Search Tasks" }).fill("Shower head leaking");
  await expect(staff.getByRole("row", { name: /Shower head leaking/ })).toContainText("Ace Plumbing"); // auto-assign rule
  await staff.getByRole("link", { name: /Shower head leaking/ }).click();
  await expect(staff.getByText("Yes", { exact: true })).toBeVisible(); // permission to enter
  await staff.getByRole("combobox", { name: "Status" }).selectOption("IN_PROGRESS");
  await expect(staff.getByText("Status: In progress")).toBeVisible();
  await staff.getByRole("textbox", { name: "Add a comment" }).fill("Plumber booked for Thursday 9–11am.");
  await staff.getByRole("switch", { name: "Visible to the tenant" }).click();
  await staff.getByRole("button", { name: "Post" }).click();
  await expect(staff.getByText("Reply sent to the tenant")).toBeVisible();
  await staff.close();

  await page.goto(url);
  await expect(page.getByText("Plumber booked for Thursday 9–11am.")).toBeVisible();
  await expect(page.getByText("Work in progress").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Add a message" }).fill("Thursday works, thanks!");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thursday works, thanks!")).toBeVisible();
});

test("vendor login sees only their jobs and can update them, but can't create tasks", async ({ page }) => {
  await signIn(page, "vendor@example.com", "/app/tasks");
  await expect(page.getByRole("heading", { name: "Your work orders" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New task" })).toHaveCount(0);
  const rows = page.getByRole("row").filter({ hasText: /#\d+/ });
  const n = await rows.count();
  for (let i = 0; i < n; i++) await expect(rows.nth(i)).toContainText("Ace Plumbing");
  await expect(page.getByText("Turn over Maple Court")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search Tasks" }).fill("Bathroom sink drains slowly");
  await page.getByRole("link", { name: /Bathroom sink drains slowly/ }).click();
  await page.getByRole("textbox", { name: "Add a comment" }).fill("On site — replacing the P-trap.");
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("Comment added")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Visible to the tenant" })).toHaveCount(0);
  await page.goto("/app/new/task");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
});

test("inspection: rate items, AI summary, printable report", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks");
  await page.getByRole("link", { name: "New task" }).click();
  const dlg = page.getByRole("dialog", { name: "New task" });
  await dlg.getByRole("combobox", { name: "Type" }).selectOption("INSPECTION");
  await dlg.getByRole("textbox", { name: "Title" }).fill("Periodic inspection — Cedar Duplex A");
  await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Cedar Duplex" });
  await dlg.getByRole("combobox", { name: "Unit" }).selectOption({ label: "Unit A" });
  await dlg.getByRole("combobox", { name: "Inspection type" }).selectOption("PERIODIC");
  await dlg.getByRole("button", { name: "Create inspection" }).click();
  await page.getByRole("textbox", { name: "Search Tasks" }).fill("Cedar Duplex A");
  await page.getByRole("link", { name: /Periodic inspection — Cedar Duplex A/ }).click();
  await expect(page.getByText("0 of 28 rated")).toBeVisible();
  const kitchen = page.getByRole("region", { name: "Kitchen" });
  await kitchen.getByRole("group", { name: "Condition of Dishwasher" }).getByText("Damaged").click();
  await kitchen.getByRole("textbox", { name: "Note for Dishwasher" }).fill("Door hinge broken");
  await kitchen.getByRole("textbox", { name: "Note for Dishwasher" }).blur();
  await expect(page.getByText("1 of 28 rated")).toBeVisible();
  await page.getByRole("button", { name: "AI summary" }).click();
  await expect(page.getByText(/Damaged: Kitchen › Dishwasher \(Door hinge broken\)/)).toBeVisible();
  const [report] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Printable report (PDF)" }).click()]);
  await expect(report.getByRole("heading", { name: "Periodic inspection" })).toBeVisible();
  await expect(report.getByRole("cell", { name: "Door hinge broken" })).toBeVisible();
});

test("work order: enter the vendor invoice as a bill (posts to A/P)", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks");
  await page.getByRole("textbox", { name: "Search Tasks" }).fill("furnace service");
  await page.getByRole("link", { name: /Annual furnace service/ }).click();
  await page.getByRole("button", { name: "Enter vendor invoice → bill" }).click();
  const d = page.getByRole("dialog", { name: "Convert vendor invoice to a bill" });
  await expect(d.getByRole("textbox", { name: "Amount" })).toHaveValue("650.00");
  await d.getByRole("textbox", { name: "Invoice #" }).fill("PA-1180");
  await d.getByRole("button", { name: "Create bill" }).click();
  await expect(page.getByText("Bill created from invoice")).toBeVisible();
  await expect(page.getByText(/Bill #PA-1180 \$650\.00 · open/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter vendor invoice → bill" })).toHaveCount(0);
});

test("can't complete a task with open subtasks", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/tasks");
  await page.getByRole("textbox", { name: "Search Tasks" }).fill("Turn over Maple Court");
  await page.getByRole("link", { name: /Turn over Maple Court/ }).click();
  await expect(page.getByRole("heading", { name: "Subtasks" })).toBeVisible();
  await page.getByRole("combobox", { name: "Status" }).selectOption("COMPLETED");
  await expect(page.getByText(/Finish the 3 open subtasks first/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("NOT_STARTED"); // rolled back
});

test("maintenance settings: add an auto-assign rule", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/settings/maintenance");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Auto-assign rules saved")).toBeVisible();
});

test("vendors list and detail", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/people/vendors");
  await expect(page.getByText("Insurance expired").first()).toBeVisible(); // Polar Air
  await page.getByRole("link", { name: "Ace Plumbing" }).click();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Bills/ }).click();
  await expect(page.getByRole("cell", { name: /ACE-2291/ })).toBeVisible();
});
