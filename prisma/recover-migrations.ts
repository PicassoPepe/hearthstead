/**
 * Runs before `prisma migrate deploy` on computer installs (scripts/start.mjs).
 *
 * A migration that failed before any of its SQL ran can safely be tried again. Prisma refuses to
 * continue (error P3009) until it's marked "rolled back", so we do that here — but only for:
 *  - failures caused by a character the database couldn't store (Windows databases created with
 *    the WIN1252 character set reject some symbols before running anything), and
 *  - migrations listed in SAFE_TO_RETRY (single statements that either fully ran or didn't).
 * Anything else is left alone and Start DeedWood stops with Prisma's message, as before.
 */
import { createNodePrisma } from "./node-client.mjs";
import { PrismaClient } from "@prisma/client";

export const SAFE_TO_RETRY = new Set(["20261114000000_scale_yearly_prices"]);
export const isSafeToRetry = (m: { migration_name: string; logs: string | null }) =>
  SAFE_TO_RETRY.has(m.migration_name) || /has no equivalent in encoding/i.test(m.logs ?? "");

export async function recoverFailedMigrations(db: PrismaClient): Promise<string[]> {
  const failed = (await db.$queryRawUnsafe(`SELECT id, migration_name, logs FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`).catch(() => [])) as { id: string; migration_name: string; logs: string | null }[];
  const retried: string[] = [];
  for (const m of failed) {
    if (!isSafeToRetry(m)) continue;
    await db.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`, m.id);
    retried.push(m.migration_name);
  }
  return retried;
}

if (process.argv[1]?.endsWith("recover-migrations.ts")) {
  const db = createNodePrisma(process.env.DATABASE_ADMIN_URL);
  recoverFailedMigrations(db)
    .then((names) => { for (const n of names) console.log(`Retrying the database update "${n}" that didn't finish last time.`); })
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
