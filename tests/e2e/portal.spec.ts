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

test.describe("tenant portal (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("pay the balance by bank → processing → staff sees it and simulates clearing", async ({ page, browser }) => {
    await tenantSignIn(page);
    await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();
    const before = await page.getByTestId("portal-balance").textContent();
    expect(before).not.toBe("$0.00");
    await page.getByRole("link", { name: "Pay now" }).click();
    await expect(page.getByRole("radio", { name: /Full balance/ })).toBeChecked();
    await expect(page.getByText("Bank convenience fee")).toBeVisible();
    await page.getByRole("button", { name: /^Pay \$/ }).click();
    await expect(page.getByRole("heading", { name: "Payment submitted" })).toBeVisible();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page.getByTestId("portal-balance")).toHaveText("$0.00");
    await expect(page.getByText("You're all paid up")).toBeVisible();

    // Tenants can't open the staff app.
    await page.goto("/app/overview");
    await expect(page).toHaveURL(/\/portal\/tenant/);

    const staff = await browser.newPage();
    await signIn(staff, "admin@example.com", "/app/accounting/payments");
    const row = staff.getByRole("button", { name: /Processing/ }).first();
    await row.click();
    await staff.getByRole("button", { name: "Simulate: clears" }).click();
    await expect(staff.getByText("Marked succeeded")).toBeVisible();
    await staff.close();
  });

  test("add a card (with validation), pay part of the balance, see the card fee", async ({ page }) => {
    await tenantSignIn(page);
    await page.goto("/portal/tenant/methods");
    await page.getByRole("tab", { name: "Card" }).click();
    await page.getByRole("textbox", { name: "Card number" }).fill("4242 4242 4242 4241");
    await page.getByRole("textbox", { name: "Expiry (MM/YY)" }).fill("12/30");
    await page.getByRole("textbox", { name: "Security code" }).fill("123");
    await page.getByRole("button", { name: "Save card" }).click();
    await expect(page.getByText("That card number isn't valid.")).toBeVisible();
    await page.getByRole("textbox", { name: "Card number" }).fill("4242 4242 4242 4242");
    await page.getByRole("button", { name: "Save card" }).click();
    await expect(page.getByText("Visa ••4242")).toBeVisible();

    await page.goto("/portal/tenant/pay");
    await page.getByRole("radio", { name: /Visa ••4242/ }).check();
    await page.getByRole("textbox", { name: "Other amount" }).fill("100");
    await expect(page.getByText("Card convenience fee")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay $103.20" })).toBeVisible(); // 2.9% + 30¢
    await page.getByRole("button", { name: "Pay $103.20" }).click();
    await expect(page.getByRole("heading", { name: "Payment successful" })).toBeVisible();
  });

  test("autopay: clear schedule, turn on, turn off", async ({ page }) => {
    await tenantSignIn(page);
    await page.goto("/portal/tenant/autopay");
    await expect(page.getByText(/Schedule: on day \d+ of every month/)).toBeVisible();
    await page.getByRole("combobox", { name: "Day of the month" }).selectOption("3");
    await page.getByRole("button", { name: "Turn on autopay" }).click();
    await expect(page.getByText("Autopay is on").first()).toBeVisible();
    await page.goto("/portal/tenant");
    await expect(page.getByText(/Full balance on day 3/)).toBeVisible();
    await page.goto("/portal/tenant/autopay");
    await page.getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Turn off autopay" }).click();
    await expect(page.getByText("Autopay turned off")).toBeVisible();
  });

  test("upload proof of insurance; staff verifies it", async ({ page, browser }) => {
    await tenantSignIn(page);
    await page.goto("/portal/tenant/insurance");
    await page.getByRole("textbox", { name: "Insurance company" }).fill("Lakeshore Mutual");
    await page.getByRole("textbox", { name: "Policy number" }).fill("LM-448812");
    await page.getByLabel("Starts").fill("2026-11-01");
    await page.getByLabel("Ends").fill("2027-10-31");
    await page.getByLabel("Declarations page (PDF or photo)").setInputFiles({ name: "dec-page.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 insurance") });
    await page.getByRole("button", { name: "Submit proof of insurance" }).click();
    await expect(page.getByText("Lakeshore Mutual · LM-448812")).toBeVisible();
    await expect(page.getByText("Under review")).toBeVisible();

    const staff = await browser.newPage();
    await signIn(staff, "admin@example.com", "/app/people/tenants");
    await staff.getByRole("textbox", { name: "Search Tenants" }).fill("tenant@example.com");
    await staff.getByRole("row").nth(1).getByRole("link").first().click();
    await staff.waitForURL(/\/app\/people\/tenants\/c/);
    await staff.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Leases/ }).click();
    await staff.getByRole("table").getByRole("link").first().click();
    await staff.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Insurance" }).click();
    await staff.getByRole("button", { name: "Mark verified" }).click();
    await expect(staff.getByText("Insurance verified")).toBeVisible();
    await staff.close();
  });
});

test("staff: create a lease with a portal invite → tenant signs in by email link → pays by card → balance $0", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "/app/leasing");
  await page.getByRole("link", { name: "New lease" }).click();
  const dlg = page.getByRole("dialog", { name: "New lease" });
  await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Commerce Park Office" });
  await dlg.getByRole("checkbox", { name: /^Suite 103/ }).check();
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("textbox", { name: "First name" }).fill("Noor");
  await dlg.getByRole("textbox", { name: "Last name" }).fill("Haddad");
  const email = `noor.${Date.now()}@example.com`;
  await dlg.getByRole("textbox", { name: "Email" }).fill(email);
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("textbox", { name: "Monthly rent" }).fill("1900");
  await dlg.getByRole("radio", { name: "No deposit" }).check();
  for (let i = 0; i < 4; i++) await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("radio", { name: /Activate the lease/ }).check();
  await dlg.getByRole("button", { name: "Create lease" }).click();
  await expect(page.getByRole("heading", { name: "Commerce Park Office · Suite 103" })).toBeVisible();
  const leaseUrl = page.url();

  // Post a charge so there's something to pay today (the lease starts next month).
  await page.getByRole("button", { name: "Post charge" }).click();
  const c = page.getByRole("dialog", { name: "Post charge" });
  await c.getByRole("textbox", { name: "Amount" }).fill("250");
  await c.getByRole("textbox", { name: "Memo" }).fill("Key deposit & move-in fee");
  await c.getByRole("button", { name: "Post charge" }).click();
  await expect(page.getByTestId("lease-balance")).toHaveText("$250.00");

  // The tenant receives the portal invitation and signs in with a magic link.
  const tenant = await browser.newPage();
  await tenant.goto("/dev/outbox");
  await tenant.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "resident portal" }).first().getByTestId("outbox-link").first().click();
  await tenant.waitForLoadState("networkidle"); // let the login form hydrate before submitting
  await tenant.getByRole("button", { name: "Email me a link" }).click();
  await expect(tenant.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  await tenant.goto("/dev/outbox");
  await tenant.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "sign-in link" }).first().getByTestId("outbox-link").first().click();
  await tenant.waitForURL("**/portal/tenant");
  await expect(tenant.getByTestId("portal-balance")).toHaveText("$250.00");
  await tenant.getByRole("link", { name: "Pay now" }).click();
  await tenant.getByRole("tab", { name: "Card" }).click();
  await tenant.getByRole("textbox", { name: "Card number" }).fill("4242424242424242");
  await tenant.getByRole("textbox", { name: "Expiry (MM/YY)" }).fill("11/31");
  await tenant.getByRole("textbox", { name: "Security code" }).fill("314");
  await tenant.getByRole("button", { name: "Save card" }).click();
  await tenant.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(tenant.getByRole("heading", { name: "Payment successful" })).toBeVisible();
  await tenant.close();

  await page.goto(leaseUrl);
  await expect(page.getByTestId("lease-balance")).toHaveText("$0.00");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Transactions/ }).click();
  await expect(page.getByText("Online payment (card)")).toBeVisible();
});

test("staff preview portal as a tenant is read-only", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/people/tenants");
  await page.getByRole("textbox", { name: "Search Tenants" }).fill("Elena Kim");
  await page.getByRole("link", { name: "Elena Kim" }).click();
  await page.getByRole("button", { name: "Preview portal as" }).click();
  await page.waitForURL("**/portal/tenant");
  await expect(page.getByRole("status").filter({ hasText: "Previewing as Elena Kim — read-only" })).toBeVisible();
  await page.goto("/portal/tenant/pay");
  await expect(page.getByRole("button", { name: "Preview only" })).toBeDisabled();
  await page.getByRole("button", { name: "Exit preview" }).click();
  await page.waitForURL(/\/app\/people\/tenants\//);
});

test("bulk invite tenants to the portal from the tenants list", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/people/tenants");
  await page.getByRole("combobox", { name: "Filter by Portal statuses" }).selectOption("NOT_INVITED");
  await page.getByRole("textbox", { name: "Search Tenants" }).fill("@example.com"); // tenants with an email address
  await page.getByRole("checkbox", { name: "Select row" }).nth(0).check();
  await page.getByRole("checkbox", { name: "Select row" }).nth(1).check();
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Invite to portal" }).click();
  await expect(page.getByText(/invitations? sent/)).toBeVisible();
});

test("settings: payments connected via the processor card", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/settings/payments");
  await expect(page.getByText("Accepting payments")).toBeVisible();
  await expect(page.getByText(/built-in mock processor/)).toBeVisible();
});
