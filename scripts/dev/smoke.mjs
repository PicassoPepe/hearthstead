/** Dev helper: sign in as admin and load pages, printing status, h1 and console errors. Usage: node scripts/dev/smoke.mjs /app/... */
import { chromium } from "@playwright/test";
const pages = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 300)));
await p.goto("http://localhost:3000/login", { timeout: 120000 });
await p.getByRole("tab", { name: "Password" }).click();
await p.getByRole("textbox", { name: "Email" }).fill(process.env.EMAIL ?? "admin@example.com");
await p.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/(app|portal)/, { timeout: 120000 });
for (const u of pages) {
  errs.length = 0;
  const r = await p.goto("http://localhost:3000" + u, { timeout: 180000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  const h1 = await p.locator("h1").first().textContent().catch(() => "?");
  console.log(r.status(), u, "|", h1, errs.length ? "ERRORS: " + errs.join(" || ") : "");
}
await b.close();
