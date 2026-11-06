import path from "node:path";
import { test, expect, signIn } from "./fixtures";

const DATA = path.join(__dirname, "fixtures-data");

test.describe("as admin", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin@example.com", "/app/leasing"));

  test("leases list: seeded history, tabs and balances", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Leases", exact: true })).toBeVisible();
    await expect(page.getByText("47 total")).toBeVisible();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Ended" }).click();
    await expect(page.getByText("3 total")).toBeVisible();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Expiring / renewals" }).click();
    await expect(page.getByRole("columnheader", { name: /Ends in/ })).toHaveAttribute("aria-sort", "ascending");
  });

  test("New Lease wizard → lease page → receive payment → balance $0", async ({ page }) => {
    await page.getByRole("link", { name: "New lease" }).click();
    const dlg = page.getByRole("dialog", { name: "New lease" });
    await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Harborview Condos" });
    await dlg.getByRole("checkbox", { name: /^101/ }).check();
    await dlg.getByRole("button", { name: "Next" }).click();

    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByText("Enter a first name").first()).toBeVisible();
    await dlg.getByRole("textbox", { name: "First name" }).fill("Selena");
    await dlg.getByRole("textbox", { name: "Last name" }).fill("Park");
    await dlg.getByRole("textbox", { name: "Email" }).fill("selena.park@example.com");
    await dlg.getByRole("button", { name: "Next" }).click();

    await expect(dlg.getByText("Proration preview")).toBeVisible();
    await dlg.getByRole("textbox", { name: "Monthly rent" }).fill("2800");
    await dlg.getByRole("radio", { name: "Bill it to the tenant" }).check();
    await dlg.getByRole("textbox", { name: "Deposit amount" }).fill("2800");
    await dlg.getByRole("button", { name: "Next" }).click();

    await dlg.getByRole("switch", { name: "Override Grace period (days)" }).click();
    await dlg.getByRole("spinbutton", { name: "Grace period days" }).fill("10");
    await dlg.getByRole("button", { name: "Next" }).click(); // documents
    await dlg.getByRole("button", { name: "Next" }).click(); // portal
    await dlg.getByRole("button", { name: "Next" }).click(); // review
    await expect(dlg.getByText("Selena Park (Primary tenant)")).toBeVisible();
    await expect(dlg.getByText("1 lease-level")).toBeVisible();
    await dlg.getByRole("button", { name: "Create lease" }).click();

    await expect(page.getByRole("heading", { name: "Harborview Condos · 101" })).toBeVisible();
    await expect(page.getByTestId("lease-balance")).toHaveText("$2,800.00"); // the deposit charge
    await page.getByRole("button", { name: "Receive payment" }).click();
    const pay = page.getByRole("dialog", { name: "Receive payment" });
    await expect(pay.getByRole("textbox", { name: "Amount" })).toHaveValue("2800.00");
    await pay.getByRole("textbox", { name: "Reference" }).fill("4242");
    await pay.getByRole("button", { name: "Receive payment" }).click();
    await expect(page.getByText("Payment received — $2,800.00")).toBeVisible();
    await expect(page.getByTestId("lease-balance")).toHaveText("$0.00");

    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.locator('[data-setting="lateFees.graceDays"]').getByText("Custom lease value")).toBeVisible();
  });

  test("one active lease per unit: overlap is blocked with a link to the conflicting lease", async ({ page }) => {
    await page.getByRole("link", { name: "New lease" }).click();
    const dlg = page.getByRole("dialog", { name: "New lease" });
    await dlg.getByRole("combobox", { name: "Property" }).selectOption({ label: "Maple Court" });
    await dlg.getByRole("checkbox", { name: /^101/ }).check();
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByText("This unit already has an active lease for these dates.").first()).toBeVisible();
    await expect(dlg.getByRole("link", { name: /Open that lease/ })).toHaveAttribute("href", /\/app\/leasing\/c/);
  });

  test("post a charge, void it with a reason; mark a payment returned with an NSF fee", async ({ page }) => {
    await page.getByRole("textbox", { name: "Search Leases" }).fill("Elena");
    await page.getByRole("link", { name: /Willow Row Townhomes/ }).first().click();
    await expect(page.getByTestId("lease-balance")).toHaveText("$0.00");

    await page.getByRole("button", { name: "Post charge" }).click();
    const dlg = page.getByRole("dialog", { name: "Post charge" });
    await dlg.getByRole("textbox", { name: "Amount" }).fill("45");
    await dlg.getByRole("textbox", { name: "Memo" }).fill("Key replacement");
    await dlg.getByRole("button", { name: "Post charge" }).click();
    await expect(page.getByTestId("lease-balance")).toHaveText("$45.00");

    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /Transactions/ }).click();
    await page.getByRole("button", { name: "Actions for Key replacement" }).click();
    await page.getByRole("menuitem", { name: "Void…" }).click();
    const v = page.getByRole("alertdialog", { name: /Void charge/ });
    await v.getByRole("textbox", { name: "Reason" }).fill("Key was found");
    await v.getByRole("button", { name: "Void transaction" }).click();
    await expect(page.getByText("Transaction voided")).toBeVisible();
    await expect(page.getByTestId("lease-balance")).toHaveText("$0.00");
    await expect(page.getByText("Void reason: Key was found")).toBeVisible();

    await page.getByRole("button", { name: "Actions for Payment" }).first().click();
    await page.getByRole("menuitem", { name: "Mark as returned (NSF)" }).click();
    await page.getByRole("dialog", { name: "Mark payment as returned" }).getByRole("button", { name: "Mark as returned" }).click();
    await expect(page.getByText("Payment marked as returned")).toBeVisible();
    await expect(page.getByTestId("lease-balance")).toHaveText("$2,735.00");
    await expect(page.getByRole("cell", { name: "NSF fee", exact: true })).toBeVisible();
  });

  test("statement page prints the ledger", async ({ page }) => {
    await page.getByRole("link", { name: /Maple Court · 104/ }).click();
    await page.getByRole("button", { name: "More" }).click();
    const [statement] = await Promise.all([page.waitForEvent("popup"), page.getByRole("menuitem", { name: "Statement" }).click()]);
    await expect(statement.getByRole("heading", { name: "Statement" })).toBeVisible();
    await expect(statement.getByText("Amount due")).toBeVisible();
  });

  test("Run rent & late fees is idempotent", async ({ page }) => {
    // The first run may post a late fee (an earlier test reopened November rent); the second posts nothing.
    await page.getByRole("button", { name: "Run rent & late fees" }).click();
    await expect(page.getByText(/Posted|Everything is up to date/)).toBeVisible();
    await page.getByRole("button", { name: "Run rent & late fees" }).click();
    await expect(page.getByText("Everything is up to date")).toBeVisible();
  });

  test("lease import: validation errors, then opening balances", async ({ page }) => {
    await page.goto("/app/files?import=leases");
    await page.getByLabel("browse").setInputFiles(path.join(DATA, "leases-bad.csv"));
    await page.getByRole("button", { name: /Validate 2 rows/ }).click();
    await expect(page.getByRole("cell", { name: /already has an active lease/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: 'No property named "Nowhere"' })).toBeVisible();
    await page.getByRole("button", { name: "Upload a different file" }).click();

    await page.getByLabel("browse").setInputFiles(path.join(DATA, "leases.csv"));
    await expect(page.getByRole("combobox", { name: "Column for Opening balance" })).toHaveValue("Balance");
    await page.getByRole("button", { name: /Validate 2 rows/ }).click();
    await page.getByRole("button", { name: /Import 2 leases/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Imported 2 leases" })).toBeVisible();
    await page.goto("/app/leasing");
    await page.getByRole("textbox", { name: "Search Leases" }).fill("Imani");
    await expect(page.getByRole("row", { name: /Imani Brooks/ }).getByText("$125.50")).toBeVisible();
    await page.getByRole("textbox", { name: "Search Leases" }).fill("Kai Moreno");
    await expect(page.getByRole("row", { name: /Kai Moreno/ }).getByText("-$40.00")).toBeVisible();
  });
});

test.describe("accounting", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin@example.com", "/app/accounting"));

  test("chart of accounts shows ledger balances; system accounts are locked", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Accounts Receivable/ })).toBeVisible();
    await page.getByRole("button", { name: "Edit Rent Income" }).click();
    await expect(page.getByRole("combobox", { name: "Type" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New account" }).click();
    const d = page.getByRole("dialog", { name: "New account" });
    await d.getByRole("textbox", { name: "Code" }).fill("5960");
    await d.getByRole("textbox", { name: "Name" }).fill("Snow Removal");
    await d.getByRole("button", { name: "Save account" }).click();
    await expect(page.getByRole("row", { name: /5960 Snow Removal/ })).toBeVisible();
  });

  test("manual journal entry must balance; void posts a reversal", async ({ page }) => {
    await page.goto("/app/accounting/journal-entries");
    await page.getByRole("link", { name: "New journal entry" }).click();
    const d = page.getByRole("dialog", { name: "New journal entry" });
    await d.getByRole("textbox", { name: "Memo" }).fill("Reclass utilities");
    await d.getByRole("combobox", { name: "Account, line 1" }).selectOption({ label: "5100 · Utilities" });
    await d.getByRole("textbox", { name: "Debit, line 1" }).fill("120");
    await d.getByRole("combobox", { name: "Account, line 2" }).selectOption({ label: "1000 · Operating Cash" });
    await d.getByRole("textbox", { name: "Credit, line 2" }).fill("100");
    await expect(d.getByText("Out of balance by $20.00")).toBeVisible();
    await expect(d.getByRole("button", { name: "Post entry" })).toBeDisabled();
    await d.getByRole("textbox", { name: "Credit, line 2" }).fill("120");
    await expect(d.getByText("Balanced ✓")).toBeVisible();
    await d.getByRole("button", { name: "Post entry" }).click();
    await expect(page.getByText("Journal entry posted — $120.00")).toBeVisible();
    await page.getByRole("button", { name: "Void" }).first().click();
    const v = page.getByRole("alertdialog", { name: "Void journal entry?" });
    await v.getByRole("textbox", { name: "Reason" }).fill("Wrong month");
    await v.getByRole("button", { name: "Void entry" }).click();
    await expect(page.getByText("Entry voided")).toBeVisible();
  });

  test("tenants list and search", async ({ page }) => {
    await page.goto("/app/people/tenants");
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search or type a command…").fill("Elena");
    await page.getByRole("option", { name: /Elena Kim/ }).click();
    await page.waitForURL(/\/app\/people\/tenants\//);
    await expect(page.getByText("Willow Row Townhomes · 103")).toBeVisible();
  });
});
