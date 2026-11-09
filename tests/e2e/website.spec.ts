import AxeBuilder from "@axe-core/playwright";
import { test, expect, signIn } from "./fixtures";

test("public website: homes, news, resident buttons; no accessibility violations", async ({ page }) => {
  await page.goto("/s/maple-main");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("site-vacancies").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("site-announcements")).toContainText("Fall gutter cleaning");
  await expect(page.getByTestId("site-residents").getByRole("link", { name: "Pay rent" })).toHaveAttribute("href", /portal%2Ftenant%2Fpay/);
  await expect(page.getByText(/Equal Housing Opportunity/)).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("staff switch a section off and publish; a visitor's message reaches People interested", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "/app/website");
  const sections = page.getByTestId("site-sections");
  await sections.getByRole("switch", { name: "Show Common questions" }).click();
  await expect(page.getByText(/Changes saved as a draft/)).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Your website is published").first()).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/s/maple-main");
  await expect(visitor.getByRole("navigation", { name: "Website" }).getByRole("link", { name: "FAQ" })).toHaveCount(0);
  const contact = visitor.locator("#contact");
  await contact.getByLabel("Your name").fill("Jordan Visitor");
  await contact.getByLabel("Email").fill(`jordan-${Date.now()}@example.org`);
  await contact.getByLabel("Your message").fill("Do you have any 2-bedroom units in December?");
  await contact.getByRole("button", { name: "Send message" }).click();
  await expect(contact.getByText(/Thanks! We got your message/)).toBeVisible();

  await page.goto("/app/people/prospects");
  await expect(page.getByText("Jordan Visitor").first()).toBeVisible();

  // Put it back for other tests.
  await page.goto("/app/website");
  await page.getByTestId("site-sections").getByRole("switch", { name: "Show Common questions" }).click();
  await expect(page.getByText(/Changes saved as a draft/)).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Your website is published").first()).toBeVisible();
});
