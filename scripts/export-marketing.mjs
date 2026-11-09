#!/usr/bin/env node
/**
 * Builds the DeedWood marketing website as a plain folder of files you can drag into
 * Cloudflare Pages (Workers & Pages → Create → Pages → Upload assets).
 *
 *   node scripts/export-marketing.mjs --out <folder> --site https://deedwood.com --app https://app.deedwood.com
 *
 * --site  the address the marketing site will have (for Google: canonical links + sitemap)
 * --app   the address of the DeedWood app (for "Sign in" / "Start free trial")
 * Works without a database (uses the accepted price list if it can't read the live one).
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { existsSync as has } from "node:fs";
import { loadEnvFile } from "node:process";

if (has(".env")) loadEnvFile(".env");
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = resolve(arg("out", "deploy/pages-static"));
const site = (arg("site", process.env.SITE_URL ?? "https://deedwood.example") ?? "").replace(/\/$/, "");
const app = (arg("app", process.env.MARKETING_APP_URL ?? process.env.AUTH_URL ?? "") ?? "").replace(/\/$/, "");
const DIST = ".next-website";
const PATHS = ["/", "/features", "/pricing", "/security", "/about", "/terms", "/privacy"];
const log = (m) => console.log(`[website] ${m}`);

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

async function main() {
  const env = { ...process.env, NODE_ENV: "production", MARKETING_STATIC: "1", SITE_URL: site, MARKETING_APP_URL: app, NEXT_DIST_DIR: DIST };
  // Always build fresh with the website's addresses: an older build could be out of date or
  // carry different addresses. It goes in its own folder, so a running DeedWood app isn't disturbed.
  log("Building DeedWood (a few minutes)…");
  const b = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "build"], { stdio: "inherit", env });
  if (b.status !== 0) throw new Error("Build failed");
  const port = await freePort();
  env.PORT = String(port);
  const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "inherit"] });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60; i++) { try { await fetch(`${base}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const p of PATHS) {
      const res = await fetch(`${base}${p}`, { redirect: "manual" });
      if (res.status !== 200) throw new Error(`${p} answered ${res.status}`);
      const dir = p === "/" ? out : join(out, p.slice(1));
      mkdirSync(dir, { recursive: true });
      const html = await res.text();
      // Google must never see links to this computer (canonical, og:image, sign-in buttons).
      const bad = html.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?[^"'\s<]*/);
      if (bad) throw new Error(`${p} links to ${bad[0]} — check --site / --app (or SITE_URL / MARKETING_APP_URL)`);
      writeFileSync(join(dir, "index.html"), html);
      log(`page ${p}`);
    }
    // Scripts, styles and fonts the pages use; logos and icons.
    cpSync(join(DIST, "static"), join(out, "_next", "static"), { recursive: true });
    for (const f of readdirSync("public")) cpSync(join("public", f), join(out, f), { recursive: true });
    for (const f of ["icon.png", "apple-icon.png"]) if (existsSync(join("src/app", f))) cpSync(join("src/app", f), join(out, f));
    writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PATHS.map((p) => `<url><loc>${site}${p}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`).join("")}</urlset>\n`);
    writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
    // Cloudflare Pages: security headers, long caching for versioned files, and app links.
    writeFileSync(join(out, "_headers"), [
      "/*", "  X-Content-Type-Options: nosniff", "  X-Frame-Options: DENY", "  Referrer-Policy: strict-origin-when-cross-origin", "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
      "  Permissions-Policy: camera=(), microphone=(), geolocation=()", "", "/_next/static/*", "  Cache-Control: public, max-age=31536000, immutable", "",
    ].join("\n"));
    writeFileSync(join(out, "_redirects"), app ? ["/login", "/signup", "/app/*", "/portal/*", "/admin"].map((p) => `${p} ${app}${p.replace("/*", "/:splat")} 302`).join("\n") + "\n" : "");
    writeFileSync(join(out, "README.txt"), `DeedWood marketing website — made ${new Date().toISOString().slice(0, 10)}\nMarketing address: ${site}\nApp address: ${app || "(same site)"}\n\nUpload this whole folder to Cloudflare Pages (Workers & Pages → Create → Pages → Upload assets).\n`);
    log(`Done → ${out}`);
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error(`[website] ${e.message}`); process.exit(1); });
