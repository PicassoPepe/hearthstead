import { test, expect, signIn } from "./fixtures";

test("bill: create with a property split, then pay it from the bills list", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/bills");
  await page.getByRole("link", { name: "New bill" }).click();
  const dlg = page.getByRole("dialog", { name: "New bill" });
  await dlg.getByRole("combobox", { name: "Vendor" }).selectOption({ label: "Green Thumb Landscaping" });
  await dlg.getByRole("textbox", { name: "Bill #" }).fill("E2E-777");
  await dlg.getByRole("button", { name: "Split across properties" }).click();
  const split = page.getByRole("dialog", { name: "Split across properties" });
  await split.getByRole("combobox", { name: "Account" }).selectOption({ label: "5500 · Landscaping" });
  await split.getByRole("textbox", { name: "Total to split" }).fill("300.01");
  await split.getByRole("checkbox", { name: /Maple Court/ }).check();
  await split.getByRole("checkbox", { name: /Oak Terrace/ }).check();
  await split.getByRole("button", { name: "Apply split" }).click();
  await expect(dlg.getByRole("textbox", { name: "Amount, line 1" })).toHaveValue("150.01");
  await expect(dlg.getByRole("textbox", { name: "Amount, line 2" })).toHaveValue("150.00");
  await dlg.getByRole("button", { name: "Create bill" }).click();
  await expect(page.getByText(/Bill created · \$300\.01/)).toBeVisible();

  await page.getByRole("textbox", { name: "Search Bills" }).fill("E2E-777");
  await page.getByRole("link", { name: "Green Thumb Landscaping" }).click();
  await expect(page.getByRole("heading", { name: /Green Thumb Landscaping · #E2E-777/ })).toBeVisible();
  await page.getByRole("button", { name: "Pay bill" }).click();
  const pay = page.getByRole("dialog", { name: /Pay Green Thumb/ });
  await pay.getByRole("textbox", { name: "Amount" }).fill("100");
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid $100.00 to Green Thumb Landscaping")).toBeVisible();
  await expect(page.getByText(/\$200\.01 open of \$300\.01/)).toBeVisible();
});

test("expense: record a card purchase", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/expenses");
  await page.getByRole("link", { name: "New expense" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New expense" });
  await dlg.getByRole("textbox", { name: "Payee" }).fill("Menards E2E");
  await dlg.getByRole("combobox", { name: "Account, line 1" }).selectOption({ label: "5000 · Repairs & Maintenance" });
  await dlg.getByRole("combobox", { name: "Property, line 1" }).selectOption({ label: "Maple Court" });
  await dlg.getByRole("textbox", { name: "Amount, line 1" }).fill("42.50");
  await dlg.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByText("Expense recorded · $42.50")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Menards E2E" })).toBeVisible();
});

test("banking: sync the feed, categorize a fee; reconcile shows the difference", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/banking");
  await page.getByRole("link", { name: "Operating Cash" }).click();
  await page.getByRole("button", { name: "Sync bank feed" }).click();
  await expect(page.getByText(/Bank feed synced/)).toBeVisible();
  await page.getByRole("button", { name: "Handled" }).click();
  await expect(page.getByText("Matched").first()).toBeVisible();

  await page.goto("/app/accounting/reconcile");
  await page.getByRole("textbox", { name: "Statement ending balance" }).fill("1.00");
  await page.getByRole("button", { name: "Start reconciling" }).click();
  await expect(page.getByTestId("rec-difference")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish reconciliation" })).toBeDisabled();
});

test("owner distributions and management-fee rules", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/accounting/distributions");
  await expect(page.getByRole("table", { name: /Cash available/ })).toBeVisible();
  await expect(page.getByText("Maple Court").first()).toBeVisible();
  await page.goto("/app/settings/management-fees");
  await expect(page.getByText(/Company default applies/)).toBeVisible();
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Management fee rules saved")).toBeVisible();
  await page.goto("/app/accounting/management-fees");
  await page.getByRole("button", { name: "Run management fees" }).click();
  await expect(page.getByText(/Nothing new to charge|Charged/)).toBeVisible();
});

test("bookkeeper can see payables and banking", async ({ page }) => {
  await signIn(page, "books@example.com", "/app/accounting/bills");
  await expect(page.getByRole("heading", { name: "Bills" })).toBeVisible();
  await page.goto("/app/accounting/banking");
  await expect(page.getByRole("heading", { name: "Banking" })).toBeVisible();
});
