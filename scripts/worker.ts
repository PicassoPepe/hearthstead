/**
 * Background worker (BullMQ on Redis). Schedules the nightly accounting job at 02:15 every day
 * and a minutely job that sends scheduled announcements, and processes both. Run with `pnpm worker`. For a one-off run without Redis: `pnpm jobs:nightly`.
 */
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { runMinutelyForAllOrgs, runNightlyForAllOrgs } from "../src/server/jobs/runner";

if (existsSync(".env")) loadEnvFile(".env");
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL } } });
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const queue = new Queue("accounting", { connection });

async function main() {
  await queue.upsertJobScheduler("minutely", { every: 60_000 }, { name: "minutely" });
  await queue.upsertJobScheduler("nightly", { pattern: "15 2 * * *" }, { name: "nightly", opts: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } } });
  new Worker(
    "accounting",
    async (job) => {
      if (job.name === "minutely") return { announcements: await runMinutelyForAllOrgs({ admin, app }) };
      if (job.name !== "nightly") return;
      const r = await runNightlyForAllOrgs({ admin, app });
      console.log(`[worker] nightly done`, JSON.stringify(r));
      return r;
    },
    { connection, concurrency: 1 },
  );
  console.log("[worker] listening on queue 'accounting' (nightly at 02:15, scheduled announcements every minute)");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
