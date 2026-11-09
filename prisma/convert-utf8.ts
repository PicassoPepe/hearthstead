/**
 * Computer installs on Windows: the built-in database used to be created with Windows' own
 * character set (WIN1252), which can't store emoji or symbols like "→" — saving them fails.
 * This one-time upgrade copies everything into a new UTF-8 database and swaps it in. The old
 * database is kept (renamed deedwood_before_utf8_<date>) and a copy of the data is saved in
 * .deedwood/, so nothing can be lost. Run by scripts/start.mjs after the database is migrated.
 */
import { createNodePrisma } from "./node-client.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createBackup, encodeBackup, listTables, restoreBackup } from "../src/server/ops/backup";

const NEW = "deedwood_utf8";
const say = (m: string) => console.log(`[deedwood] ${m}`);

export function withDatabase(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function encodingOf(db: PrismaClient) {
  const r = (await db.$queryRawUnsafe(`SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = current_database()`)) as { enc: string }[];
  return r[0]?.enc ?? "UTF8";
}

function step(args: string[], env: NodeJS.ProcessEnv, label: string) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (r.status !== 0) throw new Error(`${label} failed`);
}

export async function convertToUtf8(adminUrl: string, opts: { dataDir: string; now?: Date }): Promise<"already-utf8" | "converted"> {
  const oldName = new URL(adminUrl).pathname.slice(1);
  const db = createNodePrisma(adminUrl);
  try {
    if ((await encodingOf(db)) === "UTF8") return "already-utf8";
    say("Upgrading your database so it can store any character (one time — about a minute)…");

    // 1. Read everything (the server converts it to UTF-8 for us) and keep a copy on disk.
    const backup = await createBackup(db);
    const stamp = (opts.now ?? new Date()).toISOString().slice(0, 19).replace(/[-:T]/g, "");
    mkdirSync(opts.dataDir, { recursive: true });
    writeFileSync(join(opts.dataDir, `before-utf8-${stamp}.dwb`), encodeBackup(backup, null));

    // 2. A fresh UTF-8 database with the same structure.
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NEW}"`);
    await db.$executeRawUnsafe(`CREATE DATABASE "${NEW}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    const newUrl = withDatabase(adminUrl, NEW);
    const env = { ...process.env, DATABASE_ADMIN_URL: newUrl };
    step([resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env, "Preparing the new database");
    step([resolve("node_modules/tsx/dist/cli.mjs"), "prisma/apply-rls.ts"], env, "Securing the new database");

    // 3. Copy the data in and check every table arrived.
    const target = createNodePrisma(newUrl);
    try {
      await restoreBackup(target, backup);
      for (const t of await listTables(target)) {
        const want = backup.tables[t]?.length ?? 0;
        const got = Number(((await target.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`)) as { n: number }[])[0]?.n ?? 0);
        if (got !== want) throw new Error(`Copy check failed for ${t}: ${got} of ${want} rows`);
      }
    } finally {
      await target.$disconnect();
    }
    await db.$disconnect();

    // 4. Swap names (from the maintenance database, with nobody connected to the old one).
    const sys = createNodePrisma(withDatabase(adminUrl, "postgres"));
    try {
      await sys.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${oldName}', '${NEW}') AND pid <> pg_backend_pid()`);
      await sys.$executeRawUnsafe(`ALTER DATABASE "${oldName}" RENAME TO "${oldName}_before_utf8_${stamp}"`);
      try {
        await sys.$executeRawUnsafe(`ALTER DATABASE "${NEW}" RENAME TO "${oldName}"`);
      } catch (e) {
        await sys.$executeRawUnsafe(`ALTER DATABASE "${oldName}_before_utf8_${stamp}" RENAME TO "${oldName}"`); // put the original back
        throw e;
      }
    } finally {
      await sys.$disconnect();
    }
    say(`Database upgraded. The previous copy is kept as "${oldName}_before_utf8_${stamp}".`);
    return "converted";
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith("convert-utf8.ts")) {
  convertToUtf8(process.env.DATABASE_ADMIN_URL ?? "", { dataDir: resolve(".deedwood") })
    .catch((e) => { console.error(`[deedwood] The database upgrade didn't finish: ${e instanceof Error ? e.message : e}. Your data is unchanged.`); process.exitCode = 1; });
}
