/** One-off nightly run: `pnpm jobs:nightly [YYYY-MM-DD]` (defaults to today in each org's timezone). */
import { createNodePrisma } from "../prisma/node-client.mjs";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { runNightlyForAllOrgs } from "../src/server/jobs/runner";
import { parseISODate } from "../src/lib/dates";

if (existsSync(".env")) loadEnvFile(".env");
const admin = createNodePrisma(process.env.DATABASE_ADMIN_URL);
const app = createNodePrisma(process.env.DATABASE_URL);

runNightlyForAllOrgs({ admin, app, today: process.argv[2] ? parseISODate(process.argv[2]) : undefined })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .finally(() => Promise.all([admin.$disconnect(), app.$disconnect()]));
