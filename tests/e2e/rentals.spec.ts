import path from "node:path";
import { test, expect, signIn } from "./fixtures";

const DATA = path.join(__dirname, "fixtures-data");

test.describe("as admin", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin@example.com", "/app/rentals"));

  test("properties list shows the seeded portfolio and filters work", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Properties", exact: true })).toBeVisible();
    // Other specs may add properties to the shared seed, so counts are "at least the seed".
    await expect(page.getByText(/^(1[2-9]|[2-9]\d) total$/)).toBeVisible();
    await page.getByRole("combobox", { name: "Filter by Portfolios" }).selectOption({ label: "Commercial" });
    await expect(page.getByText(/^3 of \d+$/)).toBeVisible();
    await page.getByRole("textbox", { name: "Search Properties" }).fill("ironbridge");
    await expect(page.getByText(/^3 of \d+$/)).toBeVisible();
  });

  test("New Property wizard: validation, autocomplete, units, quick owner, create", async ({ page }) => {
    await page.getByRole("link", { name: "Add property" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New property" });
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByRole("alert").first()).toContainText("Choose a property type");

    await dlg.getByRole("radio", { name: /Multi-family/ }).click();
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByRole("heading", { name: "Step 2 of 6: Address" })).toBeFocused();

    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByText("Enter the street address")).toBeVisible();
    const street = dlg.getByRole("combobox", { name: "Street address" });
    await street.fill("418 oak");
    await dlg.getByRole("option", { name: /418 Oak St, Springfield, IL 62701/ }).click();
    await expect(dlg.getByRole("textbox", { name: "City" })).toHaveValue("Springfield");
    await dlg.getByRole("textbox", { name: "Property name" }).fill("Oak Street Flats");
    await dlg.getByRole("button", { name: "Next" }).click();

    await expect(dlg.getByRole("heading", { name: /Units/ })).toBeVisible();
    await dlg.getByRole("textbox", { name: "Beds, 101" }).fill("2");
    await dlg.getByRole("textbox", { name: "Baths, 101" }).fill("1.5");
    await dlg.getByRole("textbox", { name: "Market rent, 101" }).fill("1450");
    await dlg.getByRole("button", { name: "Duplicate 101" }).click();
    await dlg.getByRole("button", { name: "Add unit" }).click();
    await expect(dlg.getByRole("textbox", { name: "Unit name, row 3" })).toHaveValue("103");
    await expect(dlg.getByText(/3 units · \$4,350\.00 \/ mo/)).toBeVisible();
    await dlg.getByRole("button", { name: "Next" }).click();

    await expect(dlg.getByRole("combobox", { name: "Operating account" })).toHaveValue(/.+/);
    await dlg.getByRole("button", { name: "Next" }).click();

    await dlg.getByRole("textbox", { name: "New owner full name or company" }).fill("Rosa Delgado");
    await dlg.getByRole("button", { name: "Create owner" }).click();
    await expect(page.getByText("Rosa Delgado added as an owner")).toBeVisible();
    await expect(dlg.getByText("Total 100% ✓")).toBeVisible();
    await dlg.getByRole("button", { name: "Next" }).click();

    await expect(dlg.getByText("418 Oak St, Springfield, IL 62701")).toBeVisible();
    await expect(dlg.getByText("Rosa Delgado (100%)")).toBeVisible();
    await dlg.getByRole("button", { name: "Create property" }).click();
    await expect(page.getByText("Oak Street Flats created with 3 units")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Oak Street Flats" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Units 3" })).toBeVisible();
  });

  test("single-family auto-creates exactly one unit; draft saves and restores", async ({ page }) => {
    await page.getByRole("link", { name: "Add property" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New property" });
    await dlg.getByRole("radio", { name: /Single-family/ }).click();
    await dlg.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByText(/Draft saved/)).toBeVisible();
    await page.getByRole("link", { name: "Add property" }).first().click();
    await expect(dlg.getByText("Draft restored.")).toBeVisible();
    await expect(dlg.getByRole("radio", { name: /Single-family/ })).toHaveAttribute("aria-checked", "true");
    await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("combobox", { name: "Street address" }).fill("9 Birch Ln");
    await dlg.getByRole("textbox", { name: "Property name" }).fill("9 Birch Lane");
    await dlg.getByRole("textbox", { name: "City" }).fill("Evanston");
    await dlg.getByRole("combobox", { name: "State" }).selectOption("IL");
    await dlg.getByRole("textbox", { name: "ZIP" }).fill("60201");
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByText("Single-family homes have exactly one unit")).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Add unit" })).toHaveCount(0);
    await expect(dlg.getByRole("textbox", { name: "Unit name, row 1" })).toHaveValue("Main");
    await dlg.getByRole("button", { name: "Start over" }).click();
    await expect(dlg.getByText("Draft restored.")).toHaveCount(0);
  });

  test("property settings inherit from the company with per-property overrides", async ({ page }) => {
    await page.getByRole("link", { name: "Maple Court" }).click();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Settings" }).click();
    const grace = page.locator('[data-setting="lateFees.graceDays"]');
    await expect(grace.getByText("Custom property value")).toBeVisible();
    await expect(grace.getByRole("spinbutton")).toHaveValue("7");
    const fee = page.locator('[data-setting="lateFees.amountCents"]');
    await expect(fee.getByText("Inherited from Company: $75.00")).toBeVisible();
    await fee.getByRole("switch", { name: "Override Flat fee amount" }).click();
    await expect(page.getByText("Flat fee amount: custom property value on")).toBeVisible();
    await fee.getByRole("switch", { name: "Override Flat fee amount" }).click();
    await expect(page.getByText(/now uses the company value/)).toBeVisible();
  });

  test("notes and file uploads on a property", async ({ page }) => {
    await page.getByRole("link", { name: "Cedar Duplex" }).click();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Notes/ }).click();
    await page.getByRole("textbox", { name: "Add a note" }).fill("Snow removal contract renews in March.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Snow removal contract renews in March.")).toBeVisible();

    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Files/ }).click();
    await page.getByLabel("browse").setInputFiles({ name: "inspection.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
    await expect(page.getByText("1 file uploaded")).toBeVisible();
    await expect(page.getByRole("link", { name: "inspection.pdf", exact: true })).toBeVisible();
    const res = await page.request.get(await page.getByRole("link", { name: "inspection.pdf", exact: true }).getAttribute("href") ?? "");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
  });

  test("CSV importer: map, validate, import", async ({ page }) => {
    await page.goto("/app/files?import=properties");
    await page.getByLabel("browse").setInputFiles(path.join(DATA, "bad.csv"));
    await page.getByRole("button", { name: /Validate 1 rows/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "problems found" })).toBeVisible();
    await expect(page.getByRole("cell", { name: 'Unknown property type "castle"' })).toBeVisible();
    await page.getByRole("button", { name: "Upload a different file" }).click();

    await page.getByLabel("browse").setInputFiles(path.join(DATA, "properties.csv"));
    await expect(page.getByRole("combobox", { name: "Column for Property name" })).toHaveValue("Building");
    await expect(page.getByRole("combobox", { name: "Column for Market rent" })).toHaveValue("Monthly Rent");
    await page.getByRole("button", { name: /Validate 3 rows/ }).click();
    await expect(page.getByText(/All rows look good/)).toBeVisible();
    await page.getByRole("button", { name: /Import 1 new property, 3 units/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Imported 1 new property, 3 units." })).toBeVisible();
    await page.getByRole("link", { name: "View properties" }).click();
    await expect(page.getByRole("link", { name: "Juniper Lofts" })).toBeVisible();
  });

  test("create an owner from Create new and land on their page", async ({ page }) => {
    await page.getByRole("button", { name: "Create new" }).click();
    await page.getByRole("menuitem", { name: "Owner" }).click();
    const dlg = page.getByRole("dialog", { name: "New owner" });
    await dlg.getByRole("button", { name: "Create owner" }).click();
    await expect(dlg.getByText("Enter a first name")).toBeVisible();
    await dlg.getByRole("textbox", { name: "First name" }).fill("Theo");
    await dlg.getByRole("textbox", { name: "Last name" }).fill("Marsh");
    await dlg.getByRole("textbox", { name: "Last 4 digits" }).fill("12a4");
    await dlg.getByRole("button", { name: "Create owner" }).click();
    await expect(dlg.getByText("Last 4 digits only")).toBeVisible();
    await dlg.getByRole("combobox", { name: "Tax ID type" }).selectOption("SSN");
    await dlg.getByRole("textbox", { name: "Last 4 digits" }).fill("2345");
    await dlg.getByRole("button", { name: "Create owner" }).click();
    await expect(page.getByText("Owner created")).toBeVisible();
    await page.goto("/app/people/owners");
    await page.getByRole("link", { name: "Theo Marsh" }).click();
    await expect(page.getByText("SSN ••2345")).toBeVisible();
  });

  test("global search finds properties, units and owners", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByPlaceholder("Search or type a command…").fill("harborview");
    await expect(page.getByRole("option", { name: /Harborview Condos/ }).first()).toBeVisible();
    await page.getByPlaceholder("Search or type a command…").fill("whitfield");
    await page.getByRole("option", { name: /Dana Whitfield/ }).click();
    await page.waitForURL(/\/app\/people\/owners\//);
  });

  test("archiving: blocked while leases are active; otherwise confirms and can be undone", async ({ page }) => {
    await page.getByRole("row", { name: /35 Aspen Court/ }).getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/has active or draft leases/)).toBeVisible();
    await expect(page.getByRole("link", { name: "35 Aspen Court" })).toBeVisible();

    // "Oak Street Flats" was created by the wizard test above and has no leases.
    await page.getByRole("row", { name: /Oak Street Flats/ }).getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("link", { name: "Oak Street Flats" })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("link", { name: "Oak Street Flats" })).toBeVisible();
  });

  test("a property, unit, tenant and lease can be saved with the minimum and no bank connection", async ({ page }) => {
    await page.getByRole("link", { name: "Add property" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New property" });
    await dlg.getByRole("radio", { name: /Multi-family/ }).click();
    await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("textbox", { name: "Property name" }).fill("Name Only Cottage");
    await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("button", { name: "Remove 101" }).click();
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(dlg.getByRole("heading", { name: /Bank accounts/ })).toBeVisible();
    await dlg.getByRole("button", { name: "Skip for now" }).click();
    await expect(dlg.getByRole("heading", { name: /Owners/ })).toBeVisible();
    await dlg.getByRole("button", { name: "Skip for now" }).click();
    await expect(dlg.getByText("Not set").first()).toBeVisible();
    await dlg.getByRole("button", { name: "Create property" }).click();
    await expect(page.getByRole("heading", { name: "Name Only Cottage" })).toBeVisible();
    await expect(page).not.toHaveURL(/stripe|plaid|connect/i);

    await page.getByRole("link", { name: "Add unit" }).click();
    const unit = page.getByRole("dialog", { name: "New unit" });
    await unit.getByRole("textbox", { name: "Unit name" }).fill("A");
    await unit.getByRole("button", { name: "Add unit" }).click();
    await expect(page.getByRole("link", { name: "Units 1" })).toBeVisible();

    await page.getByRole("button", { name: "Create new" }).click();
    await page.getByRole("menuitem", { name: "Tenant" }).click();
    const tenant = page.getByRole("dialog", { name: "New tenant" });
    await tenant.getByRole("textbox", { name: "First name" }).fill("Samarra");
    await tenant.getByRole("button", { name: "Create tenant" }).click();
    await expect(page.getByText("Tenant created")).toBeVisible();

    await page.getByRole("button", { name: "Create new" }).click();
    await page.getByRole("menuitem", { name: "Lease" }).click();
    const lease = page.getByRole("dialog", { name: "New lease" });
    await lease.getByRole("combobox", { name: "Property" }).selectOption({ label: "Name Only Cottage" });
    await lease.getByRole("checkbox", { name: /^A\b/ }).check();
    await lease.getByRole("button", { name: "Next" }).click();
    await lease.getByRole("radio", { name: "Existing tenant" }).check();
    await lease.getByRole("combobox", { name: "Tenant" }).selectOption({ label: "Samarra" });
    await lease.getByRole("button", { name: "Next" }).click();
    for (let i = 0; i < 4; i++) await lease.getByRole("button", { name: "Skip for now" }).click();
    await lease.getByRole("button", { name: "Create lease" }).click();
    await expect(page.getByRole("heading", { name: "Name Only Cottage · A" })).toBeVisible();
    await expect(page).not.toHaveURL(/stripe|plaid/i);
  });
});

test("a member scoped to one portfolio only sees those properties", async ({ page }) => {
  await signIn(page, "maint@example.com", "/app/rentals");
  await expect(page.getByText("4 total")).toBeVisible();
  await expect(page.getByRole("link", { name: "Maple Court" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Harborview Condos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add property" })).toHaveCount(0);
});
