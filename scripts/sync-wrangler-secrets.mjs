#!/usr/bin/env node
/**
 * Copy named environment variables into Worker secrets. Values are never printed.
 * Usage: node scripts/sync-wrangler-secrets.mjs DATABASE_URL AUTH_SECRET ...
 */
import { spawnSync } from "node:child_process";

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Pass secret names to copy.");
  process.exit(1);
}
for (const name of names) {
  const value = process.env[name];
  if (!value) {
    console.log(`[secrets] skip ${name} (not set)`);
    continue;
  }
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], { input: value, encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").split("\n").slice(-5).join("\n");
    console.error(`[secrets] failed to set ${name}`);
    if (err) console.error(err);
    process.exit(r.status ?? 1);
  }
  console.log(`[secrets] set ${name}`);
}
