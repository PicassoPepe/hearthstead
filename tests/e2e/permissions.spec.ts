import { test, expect, signIn } from "./fixtures";

test("vendor sees only what their role allows", async ({ page }) => {
  await signIn(page, "vendor@example.com");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Repairs" })).toBeVisible();
  for (const hidden of ["Rent & Money", "Properties", "Tenants", "Reports", "Settings"]) {
    await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
  }
  await page.goto("/app/settings/users");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
  await page.goto("/app/accounting");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
  await page.goto("/app/new/user");
  await expect(page.getByRole("heading", { name: "You don't have access" })).toBeVisible();
});

test("property manager can view but not edit company settings", async ({ page }) => {
  await signIn(page, "pm@example.com");
  await page.goto("/app/settings/late-fees");
  await expect(page.getByRole("switch", { name: /^Override/ })).toHaveCount(0);
  await page.goto("/app/settings");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Company name" })).toBeDisabled();
});

test("search API requires a session", async ({ request }) => {
  const res = await request.get("/api/search?q=pri");
  expect(res.status()).toBe(401);
});
