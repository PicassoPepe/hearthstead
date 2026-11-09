/**
 * Backups from the command line.
 *   pnpm db:backup                      make a backup now (same as the nightly one)
 *   pnpm db:restore --latest --yes      put the newest backup back (REPLACES everything)
 *   pnpm db:restore --file path.dwb --yes
 */
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { runBackup, readBackup } from "../src/server/ops/backup-job";
import { decodeBackup, restoreBackup } from "../src/server/ops/backup";

if (existsSync(".env")) loadEnvFile(".env");
const args = process.argv.slice(2);
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL } } });

async function main() {
  if (args[0] === "restore") {
    if (!args.includes("--yes")) throw new Error("Restoring REPLACES everything in the database with the backup. Run again with --yes to confirm.");
    const fi = args.indexOf("--file");
    const b = fi > 0 ? decodeBackup(readFileSync(args[fi + 1]!), process.env.BACKUP_KEY?.trim() || null) : (await readBackup(db, args.includes("--latest") ? "latest" : (args[args.indexOf("--id") + 1] ?? "latest"))).decode();
    console.log(`Restoring the backup from ${b.createdAt} (${Object.keys(b.tables).length} tables)…`);
    const r = await restoreBackup(db, b);
    console.log(`Done: ${r.rows} rows in ${r.tables} tables.`);
  } else {
    const r = await runBackup(db);
    if (!r.ok) throw new Error(r.error ?? "Backup failed");
    console.log(`Backup saved: ${r.key} (${Math.round(r.bytes / 1024)} KB, ${r.rows} rows${r.encrypted ? ", encrypted" : ""})`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
