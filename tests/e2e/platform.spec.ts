import { test, expect, signIn } from "./fixtures";
import { totp } from "../../src/server/platform/totp";

const DEMO_KEY = "dw_live_00dea100_localDemoKeyDoNotUseInProduction";

test("API: list with cursor pagination, create with an idempotency key, errors are JSON", async ({ request }) => {
  const auth = { Authorization: `Bearer ${DEMO_KEY}` };
  const p1 = await request.get("/api/v1/properties?limit=5", { headers: auth });
  expect(p1.status()).toBe(200);
  expect(p1.headers()["x-ratelimit-limit"]).toBe("120");
  const b1 = await p1.json();
  expect(b1.data).toHaveLength(5);
  expect(b1.has_more).toBe(true);
  const p2 = await (await request.get(`/api/v1/properties?limit=5&cursor=${b1.next_cursor}`, { headers: auth })).json();
  expect(p2.data[0].id).not.toBe(b1.data[0].id);

  const key = `e2e-${Date.now()}`;
  const body = { title: "Check the boiler pressure", priority: "HIGH" };
  const c1 = await request.post("/api/v1/tasks", { headers: { ...auth, "Idempotency-Key": key }, data: body });
  expect(c1.status()).toBe(201);
  const c2 = await request.post("/api/v1/tasks", { headers: { ...auth, "Idempotency-Key": key }, data: body });
  expect(c2.headers()["idempotent-replayed"]).toBe("true");
  expect((await c2.json()).id).toBe((await c1.json()).id);
  const conflict = await request.post("/api/v1/tasks", { headers: { ...auth, "Idempotency-Key": key }, data: { title: "Something else" } });
  expect(conflict.status()).toBe(409);

  const bad = await request.post("/api/v1/tasks", { headers: auth, data: { title: "x" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.type).toBe("invalid_request_error");
  expect((await request.get("/api/v1/leases", { headers: { Authorization: "Bearer nope" } })).status()).toBe(401);
  const spec = await (await request.get("/api/v1/openapi.json")).json();
  expect(spec.openapi).toBe("3.1.0");
});

test("integrations: create an API key (shown once) and send a test webhook", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/settings/integrations");
  await page.getByRole("button", { name: "Create API key" }).click();
  const dlg = page.getByRole("dialog", { name: "Create API key" });
  const keyName = `E2E integration ${Date.now() % 100000}`;
  await dlg.getByRole("textbox", { name: "Name" }).fill(keyName);
  await dlg.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("new-api-key")).toHaveText(/^dw_live_[a-f0-9]{8}_/);
  const key = (await page.getByTestId("new-api-key").textContent())!;
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table", { name: "API keys" }).getByRole("cell", { name: keyName, exact: true })).toBeVisible();
  const res = await page.request.get("/api/v1/leases?limit=1", { headers: { Authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);

  await page.getByRole("button", { name: /Send test event to/ }).first().click();
  await expect(page.getByText("Test event sent")).toBeVisible();
  await expect(page.getByRole("table", { name: "Webhook deliveries" }).getByText("200").first()).toBeVisible();
});

test("workflows: build one from the UI", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/workflows");
  await expect(page.getByRole("heading", { name: "Urgent tenant request → alert the property manager" })).toBeVisible();
  await page.getByRole("button", { name: "New workflow" }).click();
  const dlg = page.getByRole("dialog", { name: "New workflow" });
  await dlg.getByRole("textbox", { name: "Name" }).fill("Big payment → thank-you email");
  await dlg.getByRole("combobox", { name: "When" }).selectOption("payment.succeeded");
  await dlg.getByRole("button", { name: "Add condition" }).click();
  await dlg.getByRole("combobox", { name: "Condition 1 operator" }).selectOption("gt");
  await dlg.getByRole("textbox", { name: "Condition 1 value" }).fill("2000");
  await dlg.getByRole("combobox", { name: "Action 1" }).selectOption("SEND_EMAIL");
  await dlg.getByRole("textbox", { name: "Subject" }).fill("Thanks for your payment");
  await dlg.getByRole("textbox", { name: "Message" }).fill("We received {{amountCents}}. Thank you!");
  await dlg.getByRole("button", { name: "Save workflow" }).click();
  await expect(page.getByText("Workflow saved")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Big payment → thank-you email" })).toBeVisible();
});

test("AI assistant answers from data and only creates a task after confirmation; agents can be approved", async ({ page }) => {
  await signIn(page, "admin@example.com", "/app/ai");
  await page.getByRole("button", { name: "Who owes rent?" }).click();
  await expect(page.getByText(/tenants owe \$[\d,.]+ in total/)).toBeVisible();
  await page.getByRole("textbox", { name: "Ask the assistant" }).fill("Create a task to replace the lobby mat at Maple Court");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("group", { name: "Proposed action" });
  await expect(card).toContainText("Replace the lobby mat at Maple Court");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText(/✓ Created task #\d+/)).toBeVisible();

  await page.getByRole("link", { name: /Agents/ }).click();
  const first = page.getByRole("button", { name: /^Approve: Reply to/ }).first();
  await first.click();
  await expect(page.getByText("Reply sent").first()).toBeVisible();
});

test("security: turn on 2FA, then signing in requires the code", async ({ page, browser }) => {
  await signIn(page, "books@example.com", "/app/settings/security");
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByRole("textbox", { name: "6-digit code" }).fill(totp(secret));
  await page.getByRole("button", { name: "Verify & turn on" }).click();
  await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(8);
  await expect(page.getByText("Active sessions")).toBeVisible();

  const fresh = await browser.newPage();
  await fresh.goto("/login");
  await fresh.getByRole("tab", { name: "Password" }).click();
  await fresh.waitForLoadState("networkidle");
  await fresh.getByRole("textbox", { name: "Email" }).fill("books@example.com");
  await fresh.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
  await fresh.getByRole("button", { name: "Sign in" }).click();
  await expect(fresh.getByText("Enter the 6-digit code from your authenticator app.")).toBeVisible();
  await fresh.getByRole("textbox", { name: "Authentication code" }).fill("000000");
  await fresh.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(fresh.getByText(/That code didn't work/)).toBeVisible();
  await fresh.getByRole("textbox", { name: "Authentication code" }).fill(totp(secret));
  await fresh.getByRole("button", { name: "Verify and sign in" }).click();
  await fresh.waitForURL("**/app/**");
  await fresh.close();

  // Turn it back off so other tests that sign in as books@ keep working.
  await page.goto("/app/settings/security");
  await page.getByRole("textbox", { name: "Code to turn off" }).fill(totp(secret));
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("Two-factor authentication turned off")).toBeVisible();
});
