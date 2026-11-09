/**
 * Background jobs without Redis, for the one-click local setup (scripts/start.mjs).
 * Runs the minutely job (scheduled announcements, webhook retries, AI agents) every minute and the
 * nightly job (rent, late fees, autopay, reminders, statements…) at 02:15 — plus once at start-up if
 * it hasn't run today, so a computer that was off overnight catches up. Both jobs are idempotent.
 * (With Redis available, `pnpm worker` does the same through BullMQ.)
 */
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runMinutelyForAllOrgs, runNightlyForAllOrgs } from "../src/server/jobs/runner";
import { licenseCheckIn } from "../src/server/license/local";

if (existsSync(".env")) loadEnvFile(".env");
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL } } });
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const STAMP = ".deedwood/last-nightly";
const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const lastNightly = () => (existsSync(STAMP) ? readFileSync(STAMP, "utf8").trim() : "");

let busy = false;
async function nightly() {
  if (busy) return;
  busy = true;
  try {
    const r = await runNightlyForAllOrgs({ admin, app });
    // Computer installs: check the license in with DeedWood (skipped when offline / not set up).
    const units = await admin.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } });
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    await licenseCheckIn(pkg.version, units).catch(() => null);
    mkdirSync(".deedwood", { recursive: true });
    writeFileSync(STAMP, today());
    console.log(`[jobs] nightly done ${JSON.stringify(r).slice(0, 300)}`);
  } catch (e) {
    console.error("[jobs] nightly failed", e);
  } finally {
    busy = false;
  }
}

async function minutely() {
  try {
    await runMinutelyForAllOrgs({ admin, app });
  } catch (e) {
    console.error("[jobs] minutely failed", e);
  }
}

async function main() {
  if (lastNightly() !== today()) await nightly();
  setInterval(() => void minutely(), 60_000);
  // Check every minute whether it's past 02:15 local time and today's run hasn't happened.
  setInterval(() => {
    const now = new Date();
    if ((now.getHours() > 2 || (now.getHours() === 2 && now.getMinutes() >= 15)) && lastNightly() !== today()) void nightly();
  }, 60_000);
  console.log("[jobs] running (every minute; nightly at 02:15)");
}

void main();
