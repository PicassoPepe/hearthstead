/** Dev helper: list elements wider than the viewport. Usage: node scripts/dev/overflow.mjs /app/overview [width] */
import { chromium } from "@playwright/test";
const [path, w = "360"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(w), height: 740 } });
await p.goto("http://localhost:3000/login");
await p.getByRole("tab", { name: "Password" }).click();
await p.getByRole("textbox", { name: "Email" }).fill(process.env.EMAIL ?? "admin@example.com");
await p.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(/\/(app|portal)/, { timeout: 120000 });
await p.goto("http://localhost:3000" + path);
await p.waitForLoadState("networkidle");
const r = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.right > vw + 1 && rect.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 90)} right=${Math.round(rect.right)} w=${Math.round(rect.width)}`);
  }
  return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 12) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
