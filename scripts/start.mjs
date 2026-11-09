#!/usr/bin/env node
/**
 * DeedWood one-click start (what "Start DeedWood.bat" / ".command" run). No Docker, no Postgres
 * install, no Redis:
 *   1. creates .env (random secret) on first run
 *   2. runs a built-in PostgreSQL 16 (data in .deedwood/postgres, port 54329)
 *   3. migrates, applies row-level security, loads demo data on first run
 *   4. builds the app when the code has changed (first run takes a few minutes)
 *   5. starts the app + background jobs and opens your browser
 * Press Ctrl+C (or close the window) to stop. Your data stays in the .deedwood folder.
 *
 * Use your own Postgres instead: set DEEDWOOD_DB=external and the two DATABASE_* URLs in .env.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const DATA = join(ROOT, ".deedwood");
const PG_PORT = Number(process.env.DEEDWOOD_PG_PORT ?? 54329);
const node = process.execPath;
// Absolute paths so "Start DeedWood" can find and close an older copy that is still running.
const bin = { prisma: resolve("node_modules/prisma/build/index.js"), tsx: resolve("node_modules/tsx/dist/cli.mjs"), next: resolve("node_modules/next/dist/bin/next") };

const children = [];
let pg = null;
let stopping = false;
const say = (msg) => console.log(`\n\x1b[32m●\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
};

// ── 0. Prerequisites ──────────────────────────────────────────────────────
const [major] = process.versions.node.split(".").map(Number);
if (major < 22) fail(`DeedWood needs Node.js 22 or newer (you have ${process.versions.node}). Install the LTS version from https://nodejs.org and try again.`);
if (!existsSync(bin.next) || !existsSync(bin.prisma)) fail("Packages aren't installed yet. Run the Start file again (it installs them), or run: corepack pnpm install");

// ── 1. .env ───────────────────────────────────────────────────────────────
function readEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*(#.*)?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function setEnvValues(path, values) {
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}="${v}"`;
    text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(path, text);
}

if (!existsSync(".env")) {
  writeFileSync(".env", readFileSync(".env.example", "utf8"));
  setEnvValues(".env", { AUTH_SECRET: randomBytes(32).toString("base64url") });
  say("Created your settings file (.env)");
}
let env = readEnv(".env");
const external = (process.env.DEEDWOOD_DB ?? env.DEEDWOOD_DB) === "external";
if (!external) {
  setEnvValues(".env", {
    DATABASE_ADMIN_URL: `postgresql://postgres:postgres@localhost:${PG_PORT}/deedwood`,
    DATABASE_URL: `postgresql://deedwood_app:deedwood_app@localhost:${PG_PORT}/deedwood`,
  });
}
// Local use: show the email outbox and SMS simulator (emails aren't really sent until you set up a provider).
if (!env.ENABLE_DEV_TOOLS) setEnvValues(".env", { ENABLE_DEV_TOOLS: "1" });
env = readEnv(".env");

// ── 2. Database ───────────────────────────────────────────────────────────
const portOpen = (port) => new Promise((resolve) => {
  const s = connect(port, "127.0.0.1");
  s.on("connect", () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
});

if (!external) {
  if (await portOpen(PG_PORT)) {
    say(`Database already running on port ${PG_PORT}`);
  } else {
    say("Starting the built-in database…");
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = join(DATA, "postgres");
    const fresh = !existsSync(join(dir, "PG_VERSION"));
    mkdirSync(DATA, { recursive: true });
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: PG_PORT, persistent: true, onLog: () => {}, onError: () => {} });
    try {
      if (fresh) await pg.initialise();
      await pg.start();
      if (fresh) await pg.createDatabase("deedwood");
    } catch (e) {
      fail(`Couldn't start the built-in database: ${e instanceof Error ? e.message : e}\nIf another copy of DeedWood is open, close it first.`);
    }
  }
}

const run = (args, label) => {
  const r = spawnSync(node, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) { stopAll(); fail(`${label} failed (see the messages above).`); }
};

say("Preparing the database…");
run([bin.prisma, "migrate", "deploy"], "Database update");
run([bin.tsx, "prisma/apply-rls.ts"], "Database security setup");
run([bin.tsx, "prisma/backfill.ts"], "Database backfill");

const { PrismaClient } = (await import("@prisma/client")).default;
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_ADMIN_URL } } });
const orgs = await db.organization.count().catch(() => 0);
await db.$disconnect();
if (orgs === 0) {
  say("Loading demo data (about a minute, first run only)…");
  run([bin.tsx, "--conditions=react-server", "prisma/seed.ts"], "Demo data");
}

// ── 3. Build when the code changed ────────────────────────────────────────
function codeStamp() {
  const h = createHash("sha256");
  const walk = (p) => {
    for (const name of readdirSync(p).sort()) {
      const f = join(p, name);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else h.update(`${f}:${st.size}:${st.mtimeMs}\n`);
    }
  };
  for (const p of ["src", "public"]) if (existsSync(p)) walk(p);
  for (const f of ["package.json", "next.config.ts", "prisma/schema.prisma", "postcss.config.mjs"]) if (existsSync(f)) h.update(`${f}:${statSync(f).mtimeMs}\n`);
  return h.digest("hex");
}
const stampFile = join(".next", "deedwood-build-stamp");
const stamp = codeStamp();
if (!existsSync(join(".next", "BUILD_ID")) || !existsSync(stampFile) || readFileSync(stampFile, "utf8") !== stamp) {
  say("Building DeedWood (a few minutes the first time and after updates)…");
  run([bin.next, "build"], "Build");
  writeFileSync(stampFile, stamp);
}

// ── 4. Start ──────────────────────────────────────────────────────────────
const free = (port) => new Promise((resolve) => {
  const s = createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true))).listen(port, "127.0.0.1");
});
let port = Number(process.env.PORT ?? 3000);
while (!(await free(port))) port++;
const url = `http://localhost:${port}`;
const childEnv = { ...process.env, ...env, NODE_ENV: "production", AUTH_URL: url, PORT: String(port) };

const jobs = spawn(node, [bin.tsx, "--conditions=react-server", "scripts/scheduler.ts"], { stdio: ["ignore", "inherit", "inherit"], env: childEnv });
children.push(jobs);
const web = spawn(node, [bin.next, "start", "-p", String(port), "-H", "127.0.0.1"], { stdio: ["ignore", "pipe", "inherit"], env: childEnv });
children.push(web);
web.stdout.on("data", () => {}); // quiet; errors still show on stderr

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  if (pg) pg.stop().catch(() => {}).finally(() => process.exit(0));
  else process.exit(0);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
process.on("SIGHUP", stopAll);
web.on("exit", (code) => { if (!stopping) { console.error(`\nThe app stopped (code ${code}).`); stopAll(); } });

for (let i = 0; i < 120 && !(await portOpen(port)); i++) await new Promise((r) => setTimeout(r, 500));
console.log(`
\x1b[1m DeedWood is running at ${url} \x1b[0m

   Sign in:  admin@example.com   password:  Demo1234!x
   Emails the app "sends" appear at ${url}/dev/outbox

   Keep this window open while you use DeedWood. Press Ctrl+C (or close it) to stop.
`);
const open = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
if (!process.env.DEEDWOOD_NO_BROWSER) spawn(open[0], open[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
