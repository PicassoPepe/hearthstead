import { test as base, expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo1234!x";

export async function signIn(page: Page, email: string, next = "/app/overview") {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(next)}`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**${next}`);
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

/** Fails any test that logs a console error or hydration warning. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
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
