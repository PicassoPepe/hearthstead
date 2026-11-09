import { test as base, expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo1234!x";

export async function signIn(page: Page, email: string, next = "/app/overview") {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(next)}`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
  await page.waitForLoadState("networkidle"); // hydrated (and prefetches settled) before the test acts
}

/**
 * Radix modals/menus set aria-hidden on the rest of the page. If one opens while a streamed page
 * segment is still hydrating (dev mode), React reports those attributes as a mismatch. That diff is
 * benign; any hydration diff that touches anything else still fails the test.
 */
function benignAriaHiddenMismatch(text: string) {
  if (!/hydrated but some attributes/.test(text)) return false;
  const diffs = text.split("\n").filter((l) => /^\s*[+-]\s+\S/.test(l) && /=/.test(l));
  return diffs.length > 0 && diffs.every((l) => /aria-hidden=/.test(l));
}

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
/** Map tiles come from the internet; serve blank tiles so tests don't depend on it. */
export async function stubMapTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org|server\.arcgisonline\.com/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG }));
}

/** Fails any test that logs a console error or hydration warning. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      await stubMapTiles(page);
      const errors: string[] = [];
      page.on("console", (m) => {
        if ((m.type() === "error" || /hydrat/i.test(m.text())) && !benignAriaHiddenMismatch(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Sign up a new account: details → 6-digit email code (read from the test outbox) → workspace. */
export async function signUpNewAccount(page: Page, v: { name: string; org: string; email: string; password: string }) {
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Your name" }).fill(v.name);
  await page.getByRole("textbox", { name: "Company name" }).fill(v.org);
  await page.getByRole("textbox", { name: "Work email" }).fill(v.email);
  await page.getByRole("textbox", { name: "Password" }).fill(v.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  const outbox = await page.context().newPage();
  await outbox.goto("/dev/outbox");
  const subject = await outbox.getByTestId("outbox-message").filter({ hasText: v.email }).filter({ hasText: "is your DeedWood code" }).first().locator("h2").textContent();
  await outbox.close();
  const code = /(\d{6})/.exec(subject ?? "")![1]!;
  await page.getByRole("textbox", { name: "6-digit code" }).fill(code);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.waitForURL("**/app/setup", { timeout: 60_000 });
}
