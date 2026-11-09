import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { PrismaClient } from "@prisma/client";

/**
 * Whole-database backups without extra tools: every table is read as JSON
 * (`row_to_json`) and restored with `json_populate_recordset`, so every type round-trips exactly.
 * The file is gzipped and — when BACKUP_KEY is set — encrypted with AES-256-GCM.
 *
 * Format: "DWB1" magic, then (encrypted? 1 byte) [iv 12 | tag 16 | ciphertext] or gzip bytes.
 * Inside: JSON { version, createdAt, migration, tables: { [name]: rows[] } }.
 */
export type BackupFile = { version: 1; createdAt: string; migration: string | null; tables: Record<string, unknown[]> };
const MAGIC = Buffer.from("DWB1");
const keyFrom = (k: string) => createHash("sha256").update(`deedwood-backup:${k}`).digest();

type Db = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction">;

export async function listTables(db: Db): Promise<string[]> {
  // Cast name columns to text. The pg driver adapter cannot decode Postgres's `name` type.
  const rows = (await db.$queryRawUnsafe(`SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`)) as { table_name: string }[];
  return rows.map((r) => r.table_name);
}

/** Tables ordered so a table comes after the tables its foreign keys point to. */
export async function insertOrder(db: Db, tables: string[]): Promise<string[]> {
  const fks = (await db.$queryRawUnsafe(`
    SELECT tc.table_name::text AS child, ccu.table_name::text AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)) as { child: string; parent: string }[];
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent && deps.has(f.child) && deps.has(f.parent)) deps.get(f.child)!.add(f.parent);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const p of deps.get(t) ?? []) visit(p, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

export async function createBackup(db: Db, now = new Date()): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of await listTables(db)) {
    const rows = (await db.$queryRawUnsafe(`SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) AS rows FROM "${t}" x`)) as { rows: unknown[] }[];
    tables[t] = rows[0]?.rows ?? [];
  }
  const m = (await db.$queryRawUnsafe(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`).catch(() => [])) as { migration_name: string }[];
  return { version: 1, createdAt: now.toISOString(), migration: m[0]?.migration_name ?? null, tables };
}

export function encodeBackup(b: BackupFile, key?: string | null): Buffer {
  const gz = gzipSync(Buffer.from(JSON.stringify(b)));
  if (!key) return Buffer.concat([MAGIC, Buffer.from([0]), gz]);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(key), iv);
  const enc = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGIC, Buffer.from([1]), iv, c.getAuthTag(), enc]);
}

export function decodeBackup(buf: Buffer, key?: string | null): BackupFile {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("This isn't a DeedWood backup file.");
  const encrypted = buf[4] === 1;
  let gz: Buffer;
  if (encrypted) {
    if (!key) throw new Error("This backup is encrypted. Set BACKUP_KEY to the key used when it was made.");
    const d = createDecipheriv("aes-256-gcm", keyFrom(key), buf.subarray(5, 17));
    d.setAuthTag(buf.subarray(17, 33));
    try {
      gz = Buffer.concat([d.update(buf.subarray(33)), d.final()]);
    } catch {
      throw new Error("Wrong BACKUP_KEY for this backup (or the file is damaged).");
    }
  } else gz = buf.subarray(5);
  return JSON.parse(gunzipSync(gz).toString("utf8")) as BackupFile;
}

/** Replace everything in the database with the backup's contents (one transaction). */
export async function restoreBackup(db: Db, b: BackupFile) {
  if (b.version !== 1) throw new Error("Unsupported backup version");
  const current = await listTables(db);
  const order = await insertOrder(db, current);
  await db.$transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.$executeRawUnsafe(`TRUNCATE ${current.map((x) => `"${x}"`).join(", ")} RESTART IDENTITY CASCADE`);
    for (const name of order) {
      const rows = b.tables[name];
      if (!rows?.length) continue;
      for (let i = 0; i < rows.length; i += 2000) {
        await t.$executeRawUnsafe(`INSERT INTO "${name}" SELECT * FROM json_populate_recordset(NULL::"${name}", $1::json)`, JSON.stringify(rows.slice(i, i + 2000)));
      }
    }
  }, { timeout: 10 * 60_000, maxWait: 30_000 });
  return { tables: Object.keys(b.tables).length, rows: Object.values(b.tables).reduce((n, r) => n + r.length, 0) };
}
