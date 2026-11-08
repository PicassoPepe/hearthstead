#!/usr/bin/env node
/**
 * Production start for hosted installs (Railway, Render, Fly, a VPS…). Needs only:
 *   DATABASE_ADMIN_URL  the Postgres URL your host gives you (owner account)
 *   AUTH_SECRET         a long random string
 *   AUTH_URL            the public address, e.g. https://deedwood.up.railway.app
 * It then:
 *   - derives the app's own (non-owner) database login so row-level security applies,
 *     with a private password derived from AUTH_SECRET (or APP_DB_PASSWORD if you set one),
 *   - migrates and applies row-level security,
 *   - optionally loads demo data the first time (SEED_DEMO=1),
 *   - starts the background jobs and the web server on $PORT.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) loadEnvFile(".env");
const env = { ...process.env, NODE_ENV: "production" };
const fail = (m) => { console.error(`[deedwood] ${m}`); process.exit(1); };

// Many hosts name it DATABASE_URL; treat that as the owner URL if no admin URL is given.
if (!env.DATABASE_ADMIN_URL && env.DATABASE_URL && !/deedwood_app/.test(env.DATABASE_URL)) env.DATABASE_ADMIN_URL = env.DATABASE_URL;
if (!env.DATABASE_ADMIN_URL) fail("Set DATABASE_ADMIN_URL to your Postgres connection string.");
if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || /dev-only/.test(env.AUTH_SECRET)) fail("Set AUTH_SECRET to a long random string (32+ characters).");
if (!env.AUTH_URL) fail("Set AUTH_URL to your public address, e.g. https://your-app.up.railway.app");

env.APP_DB_PASSWORD ??= createHash("sha256").update(`${env.AUTH_SECRET}:deedwood-app-db`).digest("base64url").slice(0, 32);
const app = new URL(env.DATABASE_ADMIN_URL);
app.username = "deedwood_app";
app.password = env.APP_DB_PASSWORD;
env.DATABASE_URL = app.toString();
env.AUTH_TRUST_HOST ??= "true";

const node = process.execPath;
const run = (args, label) => {
  const r = spawnSync(node, args, { stdio: "inherit", env });
  if (r.status !== 0) fail(`${label} failed`);
};
run(["node_modules/prisma/build/index.js", "migrate", "deploy"], "Migration");
run(["node_modules/tsx/dist/cli.mjs", "prisma/apply-rls.ts"], "Row-level security");
run(["node_modules/tsx/dist/cli.mjs", "prisma/backfill.ts"], "Backfill");

if (env.SEED_DEMO === "1") {
  const { PrismaClient } = (await import("@prisma/client")).default;
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_ADMIN_URL } } });
  const orgs = await db.organization.count();
  await db.$disconnect();
  if (orgs === 0) {
    console.log("[deedwood] loading demo data…");
    run(["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", "prisma/seed.ts"], "Demo data");
  }
}

const port = env.PORT ?? "3000";
const children = [
  spawn(node, ["node_modules/tsx/dist/cli.mjs", "--conditions=react-server", "scripts/scheduler.ts"], { stdio: "inherit", env }),
  spawn(node, ["node_modules/next/dist/bin/next", "start", "-p", port, "-H", "0.0.0.0"], { stdio: "inherit", env }),
];
const stop = () => { for (const c of children) c.kill("SIGTERM"); setTimeout(() => process.exit(0), 5000).unref(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
children[1].on("exit", (code) => { console.error(`[deedwood] web server exited (${code})`); stop(); process.exitCode = code ?? 1; });
console.log(`[deedwood] starting on port ${port} — ${env.AUTH_URL}`);
