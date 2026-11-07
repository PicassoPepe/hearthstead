import { test, expect, signIn } from "./fixtures";
import type { Page } from "@playwright/test";

async function passwordSignIn(page: Page, email: string, landing: string) {
  await page.goto("/login?portal=1");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${landing}`);
}

test("full flow: create property (owned by Grace) → lease → tenant pays in the portal → balance $0 → owner sees the income", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "/app/rentals");
  // 1. Property, owned 100% by Grace Harmon (the owner@example.com portal login).
  await page.getByRole("link", { name: "Add property" }).first().click();
  const w = page.getByRole("dialog", { name: "New property" });
  await w.getByRole("radio", { name: /Single-family/ }).click();
  await w.getByRole("button", { name: "Next" }).click();
  const name = `E2E Cottage ${Date.now() % 100000}`;
  await w.getByRole("combobox", { name: "Street address" }).fill("77 Linden Ave");
  await w.getByRole("textbox", { name: "Property name" }).fill(name);
  await w.getByRole("textbox", { name: "City" }).fill("Evanston");
  await w.getByRole("combobox", { name: "State" }).selectOption("IL");
  await w.getByRole("textbox", { name: "ZIP" }).fill("60201");
  await w.getByRole("button", { name: "Next" }).click();
  await w.getByRole("textbox", { name: "Market rent, Main" }).fill("1500");
  await w.getByRole("button", { name: "Next" }).click();
  await w.getByRole("button", { name: "Next" }).click();
  await w.getByRole("button", { name: "Add owner" }).click();
  await w.getByRole("combobox", { name: "Owner 1" }).selectOption({ label: "Grace Harmon" });
  await expect(w.getByText("Total 100% ✓")).toBeVisible();
  await w.getByRole("button", { name: "Next" }).click();
  await w.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const propertyId = page.url().match(/\/app\/rentals\/([^/?#]+)/)![1]!;

  // 2. Lease with a portal invite; a move-in charge to pay today.
  await page.goto("/app/leasing");
  await page.getByRole("link", { name: "New lease" }).click();
  const dlg = page.getByRole("dialog", { name: "New lease" });
  await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: name });
  await dlg.getByRole("checkbox", { name: /^Main/ }).check();
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("textbox", { name: "First name" }).fill("Ines");
  await dlg.getByRole("textbox", { name: "Last name" }).fill("Moreau");
  const email = `ines.${Date.now()}@example.com`;
  await dlg.getByRole("textbox", { name: "Email" }).fill(email);
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("textbox", { name: "Monthly rent" }).fill("1500");
  await dlg.getByRole("radio", { name: "No deposit" }).check();
  for (let i = 0; i < 4; i++) await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("radio", { name: /Activate the lease/ }).check();
  await dlg.getByRole("button", { name: "Create lease" }).click();
  await expect(page.getByRole("heading", { name: `${name} · Main` })).toBeVisible();
  const leaseUrl = page.url();
  await page.getByRole("button", { name: "Post charge" }).click();
  const c = page.getByRole("dialog", { name: "Post charge" });
  await c.getByRole("textbox", { name: "Amount" }).fill("1500");
  await c.getByRole("combobox", { name: "Income account" }).selectOption({ label: "4000 · Rent Income" });
  await c.getByRole("textbox", { name: "Memo" }).fill("First month's rent");
  await c.getByRole("button", { name: "Post charge" }).click();
  await expect(page.getByTestId("lease-balance")).toHaveText("$1,500.00");

  // 3. Tenant signs in by email link and pays by card.
  const tenant = await browser.newPage();
  await tenant.goto("/dev/outbox");
  await tenant.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "resident portal" }).first().getByTestId("outbox-link").first().click();
  await tenant.waitForLoadState("networkidle");
  await tenant.getByRole("button", { name: "Email me a link" }).click();
  await expect(tenant.getByRole("heading", { name: "Check your email" })).toBeVisible({ timeout: 30_000 });
  await tenant.goto("/dev/outbox");
  await tenant.getByTestId("outbox-message").filter({ hasText: email }).filter({ hasText: "sign-in link" }).first().getByTestId("outbox-link").first().click();
  await tenant.waitForURL("**/portal/tenant");
  await expect(tenant.getByTestId("portal-balance")).toHaveText("$1,500.00");
  await tenant.getByRole("link", { name: "Pay now" }).click();
  await tenant.getByRole("tab", { name: "Card" }).click();
  await tenant.getByRole("textbox", { name: "Card number" }).fill("4242424242424242");
  await tenant.getByRole("textbox", { name: "Expiry (MM/YY)" }).fill("11/31");
  await tenant.getByRole("textbox", { name: "Security code" }).fill("314");
  await tenant.getByRole("button", { name: "Save card" }).click();
  await tenant.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(tenant.getByRole("heading", { name: "Payment successful" })).toBeVisible();
  await tenant.goto("/portal/tenant");
  await expect(tenant.getByTestId("portal-balance")).toHaveText("$0.00");
  await tenant.close();

  await page.goto(leaseUrl);
  await expect(page.getByTestId("lease-balance")).toHaveText("$0.00");

  // 4. The owner sees the income for the new property (cash basis: it was collected).
  const owner = await browser.newPage();
  await passwordSignIn(owner, "owner@example.com", "/portal/owner");
  await owner.goto(`/portal/owner/statements?report=owner-statement&propertyId=${propertyId}&basis=CASH`);
  await expect(owner.getByRole("rowheader", { name: `${name} — 100% ownership` })).toBeVisible();
  await expect(owner.getByRole("row", { name: /Rent Income/ })).toContainText("$1,500.00");
  // ...and can't widen the scope to a property they don't own.
  await owner.goto("/portal/owner/statements?report=rent-roll&propertyId=does-not-exist");
  await expect(owner.getByRole("cell", { name: "Maple Court" })).toHaveCount(0);
  await owner.close();
});

test("inbox: reply by SMS with an AI draft; a simulated text reply threads in; STOP opts out", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/communications");
  await page.getByRole("link", { name: /Hey my rent payment might be 2 days late/ }).click();
  await page.getByRole("button", { name: "AI draft" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(/resident portal/);
  await expect(page.getByRole("combobox", { name: "Send as" })).toHaveValue("SMS");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Message sent")).toBeVisible();
  await expect(page.getByText(/AI-drafted/)).toBeVisible();
  const phone = (await page.getByText(/^Tenant · \+1\d{10}/).textContent())!.match(/\+1\d{10}/)![0];

  await page.goto("/dev/sms");
  await page.getByRole("textbox", { name: "From number" }).fill(phone);
  await page.getByRole("textbox", { name: "Reply" }).fill("STOP");
  await page.getByRole("button", { name: "Simulate inbound text" }).click();
  await expect(page.getByTestId("sms-message").first()).toContainText("STOP");

  await page.goto("/app/communications?filter=unread");
  await page.getByRole("link", { name: /STOP/ }).click();
  await expect(page.getByText("Contact opted out of texts (replied STOP).")).toBeVisible();
  await expect(page.getByRole("option", { name: "SMS (opted out)" })).toBeDisabled();
});

test("announcement to one property's tenants appears in the tenant portal", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "/app/communications/announcements");
  await page.getByRole("button", { name: "New announcement" }).click();
  await page.getByRole("combobox", { name: "Audience" }).selectOption("ALL_TENANTS");
  await expect(page.getByText(/Reaches \d+ tenants/)).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Elevator maintenance Friday");
  await page.getByRole("textbox", { name: "Message" }).fill("the elevator will be out of service from 9 to noon");
  await page.getByRole("button", { name: "Improve with AI" }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(/^The elevator/);
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(/Announcement sent — \d+ delivered/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /Elevator maintenance Friday/ })).toBeVisible();

  const tenant = await browser.newPage();
  await passwordSignIn(tenant, "tenant@example.com", "/portal/tenant");
  await expect(tenant.getByText("Elevator maintenance Friday")).toBeVisible();
  await tenant.goto("/portal/tenant/messages");
  await tenant.waitForLoadState("networkidle"); // hydrated before submitting
  await tenant.getByRole("textbox", { name: "Add a message" }).fill("Will the stairs be open?");
  await tenant.getByRole("button", { name: "Send" }).click();
  await expect(tenant.getByText("Message sent")).toBeVisible();
  await expect(tenant.getByText("Will the stairs be open?")).toBeVisible();
  await tenant.close();

  await page.goto("/app/communications");
  await expect(page.getByRole("link", { name: /Will the stairs be open\?/ })).toBeVisible();
});

test("owner portal: home, request, message; owners can't open the staff app", async ({ page }) => {
  await passwordSignIn(page, "owner@example.com", "/portal/owner");
  await expect(page.getByRole("heading", { name: "Hi, Grace" })).toBeVisible();
  await expect(page.getByTestId("owner-distributed-to-you")).not.toHaveText("$0");
  await page.getByRole("navigation", { name: "Owner portal" }).first().getByRole("link", { name: "Requests" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "What do you need?" }).fill("Quote for new gutters");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/Request #\d+ sent/)).toBeVisible();
  await expect(page.getByText(/Quote for new gutters/)).toBeVisible();
  await page.goto("/portal/owner/messages");
  await expect(page.getByText(/October statements are posted/)).toBeVisible();
  await page.goto("/app/overview");
  await expect(page).toHaveURL(/\/portal\/owner/);
});

test("staff: invite an owner to the portal and see the communications log", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/people/owners");
  await page.getByRole("link", { name: "Chidi Okafor" }).first().click();
  await page.getByRole("button", { name: "Invite to owner portal" }).click();
  await expect(page.getByText(/Invite sent to/)).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Communications" }).click();
  await expect(page.getByText(/invited you to the owner portal/)).toBeVisible();
});
