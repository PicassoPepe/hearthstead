#!/usr/bin/env node
/**
 * After `opennextjs-cloudflare build`, add the Cron Trigger handler to the generated Worker.
 * The handler calls this same Worker (WORKER_SELF_REFERENCE) so the Next.js server runs the jobs.
 * Safe to run once per build. Re-running after a fresh OpenNext build is the expected use.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, ".open-next", "worker.js");
const inner = join(root, ".open-next", "worker.next.js");
if (!existsSync(worker)) {
  console.error("[deedwood] .open-next/worker.js is missing. Run opennextjs-cloudflare build first.");
  process.exit(1);
}
const current = readFileSync(worker, "utf8");
if (current.includes("x-deedwood-cron")) {
  console.log("[deedwood] Worker already has the cron handler.");
  process.exit(0);
}
renameSync(worker, inner);
writeFileSync(
  worker,
  `import nextWorker from "./worker.next.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./worker.next.js";

const NIGHTLY = "15 7 * * *";

export default {
  fetch(request, env, ctx) {
    return nextWorker.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    const job = event.cron === NIGHTLY ? "nightly" : "minutely";
    const target = env.WORKER_SELF_REFERENCE;
    if (!target || typeof target.fetch !== "function") {
      console.error("[cron] WORKER_SELF_REFERENCE binding is missing");
      return;
    }
    ctx.waitUntil(
      target
        .fetch(
          new Request("https://deedwood.internal/api/cron?job=" + job, {
            method: "POST",
            headers: { "x-deedwood-cron": env.AUTH_SECRET || "" },
          }),
        )
        .then(async (res) => {
          if (!res.ok) console.error("[cron] " + job + " failed (" + res.status + ")");
        }),
    );
  },
};
`,
);
console.log("[deedwood] Cron handler added to .open-next/worker.js");
