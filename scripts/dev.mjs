#!/usr/bin/env node
/**
 * One-command dev, cross-platform (Windows PowerShell, macOS, Linux):
 *   1. create .env from .env.example if missing
 *   2. start docker services if Docker is running (else expect local Postgres/Redis)
 *   3. wait for Postgres, migrate, apply row-level security
 *   4. seed demo data on first run
 *   5. start Next.js
 */
import { createNodePrisma } from "../prisma/node-client.mjs";
import { spawnSync, spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { loadEnvFile } from "node:process";

const run = (cmd) => spawnSync(cmd, { shell: true, stdio: "inherit" });
const quiet = (cmd) => spawnSync(cmd, { shell: true, stdio: "ignore" }).status === 0;
const step = (msg) => console.log(`\n> ${msg}`);
const must = (cmd) => {
  if (run(cmd).status !== 0) {
    console.error(`\nFailed: ${cmd}`);
    process.exit(1);
  }
};

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}
loadEnvFile(".env");

if (quiet("docker info")) {
  step("Starting docker services (postgres, redis, mailpit, minio)...");
  must("docker compose up -d --wait postgres redis mailpit minio");
} else {
  step("Docker is not running - using local Postgres 16 and Redis.");
  if (process.platform === "linux") {
    quiet("service postgresql start");
    quiet("service redis-server start");
  }
}

step("Waiting for Postgres on localhost:5432...");
const isUp = () =>
  new Promise((resolve) => {
    const sock = connect(5432, "localhost");
    sock.on("connect", () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
let ok = false;
for (let i = 0; i < 60 && !(ok = await isUp()); i++) await new Promise((r) => setTimeout(r, 1000));
if (!ok) {
  console.error(
    "Postgres is not reachable on localhost:5432. Start Docker Desktop (or a local Postgres 16) and try again.",
  );
  process.exit(1);
}

step("Migrating database and applying row-level security...");
must("pnpm -s prisma migrate deploy");
must("pnpm -s tsx prisma/apply-rls.ts");
must("pnpm -s tsx prisma/backfill.ts");

const db = createNodePrisma();
const orgs = await db.organization.count().catch(() => 0);
await db.$disconnect();
if (orgs === 0) {
  step("Seeding demo data...");
  must("pnpm -s db:seed");
}

const port = process.env.PORT ?? "3000";
step(`Starting Next.js on http://localhost:${port}`);
// A bigger heap keeps the dev server from restarting itself on large apps (see scripts/next-dev.mjs).
const child = spawn(`node scripts/next-dev.mjs ${port}`, { shell: true, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
