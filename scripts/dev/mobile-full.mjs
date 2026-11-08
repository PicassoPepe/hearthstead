/** Dev helper: full-page phone screenshots. Usage: node scripts/dev/mobile-full.mjs outDir /app/a */
import { chromium, devices } from "@playwright/test";
const [out, ...pages] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ ...devices["iPhone 13"], deviceScaleFactor: 1 });
await p.goto("http://localhost:3000/login");
await p.getByRole("tab", { name: "Password" }).click();
await p.getByRole("textbox", { name: "Email" }).fill(process.env.EMAIL ?? "admin@example.com");
await p.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/(app|portal)/, { timeout: 120000 });
let i = 0;
for (const u of pages) {
  await p.goto("http://localhost:3000" + u, { timeout: 180000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/f${String(i++).padStart(2, "0")}.png`, fullPage: true });
}
await b.close();
