/** Dev helper: count RSC prefetch requests fired by loading a page. Usage: node scripts/dev/prefetch-count.mjs /app/leasing */
import { chromium } from "@playwright/test";
const path = process.argv[2] ?? "/app/leasing";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`http://localhost:3000/login?callbackUrl=${encodeURIComponent(path)}`);
await p.getByRole("textbox", { name: "Email" }).fill("admin@example.com");
await p.getByRole("textbox", { name: "Password" }).fill("Demo1234!x");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL(`**${path}`);
let n = 0;
p.on("request", (r) => { if (r.url().includes("_rsc=")) n++; });
await p.reload();
await p.waitForLoadState("networkidle");
console.log(path, "rsc requests after load:", n);
await b.close();
