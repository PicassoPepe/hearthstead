import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

test("signed-out visitors get the marketing site, with Google-ready tags", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Property management made simple");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
  expect(await page.locator('script[type="application/ld+json"]').first().textContent()).toContain('"SoftwareApplication"');
  expect(await page.locator('script[type="application/ld+json"]').first().textContent()).not.toContain("aggregateRating");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page.getByTestId("price-hosted_starter")).toContainText("$49");
  await expect(page.getByTestId("price-local_annual")).toContainText("$15");
  for (const path of ["/", "/pricing", "/features", "/terms"]) {
    await page.goto(path);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("robots.txt, sitemap and noindex keep private areas out of search", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/app\//);
  expect(robots).toMatch(/Disallow: \/portal\//);
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/pricing");
  expect(sitemap).not.toMatch(/\/(app|portal|admin)\//);
  for (const p of ["/portal/tenant", "/app/overview", "/login"]) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.headers()["x-robots-tag"], p).toContain("noindex");
  }
  expect((await request.get("/pricing")).headers()["x-robots-tag"]).toBeUndefined();
});
