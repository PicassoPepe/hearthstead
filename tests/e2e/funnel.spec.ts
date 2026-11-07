import { test, expect, signIn } from "./fixtures";

test("applicant: public listing → apply (autosave, validation, fee) → submit → staff approves → lease wizard is prefilled", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/l/maple-main");
  await expect(page.getByRole("heading", { name: "Homes for rent" })).toBeVisible();
  await page.getByRole("link", { name: /Harborview Condos · 101/ }).click();
  await page.getByRole("link", { name: "Apply now" }).click();
  const email = `applicant.${Date.now()}@example.com`;
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Your email" }).fill(email);
  await page.getByRole("button", { name: "Start application" }).click();
  await page.waitForURL(/\/form$/);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Enter your first name")).toBeVisible();
  await page.getByRole("textbox", { name: "First name" }).fill("Robin");
  await page.getByRole("textbox", { name: "Last name" }).fill("Hale");
  await page.getByRole("textbox", { name: "Mobile phone" }).fill("(312) 555-0188");
  await page.getByLabel("Date of birth").fill("1992-05-17");
  await page.getByRole("textbox", { name: "SSN — last 4 digits" }).fill("4321");
  await expect(page.getByRole("status").filter({ hasText: /^(Saved|Saving…|Unsaved changes)$/ })).toHaveText("Saved");
  // Autosave: reload and the answers are still there.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "First name" })).toHaveValue("Robin");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: /Step 2 of 5/ })).toBeFocused();
  await page.getByRole("textbox", { name: "Current address" }).fill("500 W Madison St, Chicago");
  await page.getByRole("textbox", { name: "Months at this address" }).fill("18");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("textbox", { name: "Employer" }).fill("Globex");
  await page.getByRole("textbox", { name: "Monthly income before taxes" }).fill("9000");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("combobox", { name: "Have you ever been evicted?" }).selectOption("no");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Submit application" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Card number" }).fill("4242424242424242");
  await page.getByRole("textbox", { name: "Expiry (MM/YY)" }).fill("12/30");
  await page.getByRole("textbox", { name: "Security code" }).fill("123");
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(page.getByText(/Application fee of \$[\d.]+ paid/)).toBeVisible();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Please confirm the authorization to continue")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("heading", { name: "Application submitted" })).toBeVisible();

  const staff = await browser.newPage();
  await signIn(staff, "admin@example.com", "/app/leasing/applications");
  await staff.getByRole("link", { name: "Robin Hale" }).click();
  await expect(staff.getByText("Meets criteria").first()).toBeVisible();
  await staff.getByRole("button", { name: "Approve" }).click();
  await expect(staff.getByText(/Application approved/)).toBeVisible();
  await staff.getByRole("link", { name: "Create lease from application" }).click();
  const dlg = staff.getByRole("dialog", { name: "New lease" });
  await expect(dlg.getByRole("combobox", { name: "Property" })).toHaveValue(/.+/);
  await dlg.getByRole("button", { name: "Next" }).click();
  await expect(dlg.getByRole("textbox", { name: "First name" })).toHaveValue("Robin");
  await expect(dlg.getByRole("textbox", { name: "Email" })).toHaveValue(email);
  await staff.close();
});

test("staff: new listing with AI description → publish → appears on the public page and in the feed", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/rentals/listings");
  await page.getByRole("button", { name: "New listing" }).click();
  const dlg = page.getByRole("dialog", { name: "New listing" });
  const unit = dlg.getByRole("combobox", { name: "Unit" });
  const firstUnit = await unit.locator("option").nth(1).textContent();
  await unit.selectOption({ index: 1 });
  await dlg.getByRole("textbox", { name: "Headline" }).fill(`E2E listing ${Date.now() % 10000}`);
  await dlg.getByRole("button", { name: "Write with AI" }).click();
  await expect(dlg.getByRole("textbox", { name: "Description" })).toHaveValue(/Welcome home/);
  const title = await dlg.getByRole("textbox", { name: "Headline" }).inputValue();
  await dlg.getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByText("Listing published")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(title) })).toContainText("Published");
  expect(firstUnit).toBeTruthy();
  await page.goto("/l/maple-main");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  const feed = await page.request.get("/api/listings/feed/maple-main");
  expect(await feed.text()).toContain(title);
});

test("e-sign: send a lease → tenant signs from the emailed link → manager countersigns → signed copy on the lease", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "/app/leasing");
  await page.getByRole("textbox", { name: "Search Leases" }).fill("Willow");
  await page.getByRole("link", { name: /Willow Row Townhomes/ }).first().click();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Files/ }).click();
  await page.getByRole("button", { name: "Send for e-signature" }).click();
  await expect(page.getByText(/Sent for e-signature/)).toBeVisible();
  const tenantRow = page.locator("section[aria-labelledby=esign-h] li").first();
  const tenantName = (await tenantRow.locator("ul li").first().textContent())!.split(" (")[0]!;

  const t = await browser.newPage();
  await t.goto("/dev/outbox");
  await t.getByTestId("outbox-message").filter({ hasText: "Please sign" }).first().getByTestId("outbox-link").first().click();
  await expect(t.getByRole("heading", { name: /Residential lease agreement/ })).toBeVisible();
  await t.waitForLoadState("networkidle");
  await t.getByRole("textbox", { name: "Type your full name to sign" }).fill("Wrong Person");
  await t.getByRole("checkbox").check();
  await t.getByRole("button", { name: "Sign document" }).click();
  await expect(t.getByText(/Type your full name exactly as shown/).first()).toBeVisible();
  await t.getByRole("textbox", { name: "Type your full name to sign" }).fill(tenantName);
  await t.getByRole("button", { name: "Sign document" }).click();
  await expect(t.getByText(/You signed on/)).toBeVisible();

  await t.goto("/dev/outbox");
  await t.getByTestId("outbox-message").filter({ hasText: "admin@example.com" }).filter({ hasText: "Please sign" }).first().getByTestId("outbox-link").first().click();
  await t.waitForLoadState("networkidle");
  await t.getByRole("textbox", { name: "Type your full name to sign" }).fill("Avery Admin");
  await t.getByRole("checkbox").check();
  await t.getByRole("button", { name: "Sign document" }).click();
  await expect(t.getByText("Everyone has signed.").first()).toBeVisible();
  await t.close();

  await page.reload();
  await expect(page.getByRole("link", { name: "Signed copy" })).toBeVisible();
});

test("renewals: offer from the renewals page goes out for signature", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/leasing/renewals");
  const btn = page.getByRole("button", { name: /^Offer renewal for/ }).first();
  await btn.click();
  const dlg = page.getByRole("dialog", { name: /Renewal offer/ });
  await expect(dlg.getByRole("textbox", { name: "New monthly rent" })).toHaveValue(/\d/);
  await dlg.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Renewal offer sent for signature")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark accepted" }).first()).toBeVisible();
});

test("public showing booking creates a prospect and a showing", async ({ page, browser }) => {
  await page.goto("/l/maple-main/harborview-condos-101");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "First name" }).fill("Kai");
  await page.getByRole("textbox", { name: "Last name" }).fill("Tour");
  await page.getByRole("textbox", { name: "Email" }).fill(`kai.${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Book showing" }).click();
  await expect(page.getByText(/You're booked for/)).toBeVisible();
  const staff = await browser.newPage();
  await signIn(staff, "admin@example.com", "/app/leasing/showings");
  await expect(staff.getByText("Kai Tour").first()).toBeVisible();
  await staff.close();
});
