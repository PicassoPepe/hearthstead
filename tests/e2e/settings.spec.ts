import { test, expect, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => signIn(page, "admin@example.com"));

test("customize a late-fee setting, persist, then revert to default with undo", async ({ page }) => {
  await page.goto("/app/settings/late-fees");
  const row = page.locator('[data-setting="lateFees.maxCents"]');
  await expect(row.getByText(/Using default: \$150\.00/)).toBeVisible();
  const input = row.getByRole("textbox", { name: "Maximum late fees per month" });
  await expect(input).toBeDisabled();

  await row.getByRole("switch", { name: "Override Maximum late fees per month" }).click();
  await expect(page.getByText("Maximum late fees per month: custom company value on")).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill("200");
  await input.blur();
  await expect(page.getByText("Maximum late fees per month saved")).toBeVisible();

  await page.reload();
  await expect(row.getByText("Custom company value")).toBeVisible();
  await expect(input).toHaveValue("200.00");

  await row.getByRole("switch", { name: "Override Maximum late fees per month" }).click();
  await expect(page.getByText(/now uses the default value/)).toBeVisible();
  await expect(row.getByText(/Using default: \$150\.00/)).toBeVisible();
  await page.reload();
  await expect(input).toHaveValue("150.00");
});

test("company details save with validation and a toast", async ({ page }) => {
  await page.goto("/app/settings");
  const color = page.getByRole("textbox", { name: "Brand color", exact: true });
  await color.fill("teal");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Use a 6-digit hex color")).toBeVisible();
  await color.fill("#0F766E");
  await page.getByRole("textbox", { name: "Phone" }).fill("(312) 555-0142");
  await page.getByRole("textbox", { name: "Street address" }).fill("400 Maple Ave");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Company details saved")).toBeVisible();
  await page.goto("/app/overview");
  // Details are now done: the item is either ticked or the whole (finished) checklist is gone.
  await expect(page.getByRole("heading", { name: /^Good to see you/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Add company details.*\(to do\)/ })).toHaveCount(0);
});

test("changing a member's role is optimistic and persists", async ({ page }) => {
  await page.goto("/app/settings/users");
  const select = page.getByRole("combobox", { name: "Role for Marco Maintenance" });
  await select.selectOption({ label: "Property Manager" });
  await expect(page.getByText("Marco Maintenance is now Property Manager")).toBeVisible();
  await page.reload();
  await expect(select).toHaveValue(await select.locator("option", { hasText: "Property Manager" }).getAttribute("value") ?? "");
});

test("removing a member confirms first and can be undone", async ({ page }) => {
  await page.goto("/app/settings/users");
  await page.getByRole("row", { name: /Marco Maintenance/ }).getByRole("button", { name: "Row actions" }).click();
  await page.getByRole("menuitem", { name: "Remove from team" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove Marco Maintenance?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("row", { name: /Marco Maintenance/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Marco Maintenance restored")).toBeVisible();
  await expect(page.getByRole("row", { name: /Marco Maintenance/ })).toBeVisible();
});
