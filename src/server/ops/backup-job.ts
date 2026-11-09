import type { PrismaClient } from "@prisma/client";
import { getStorage } from "@/adapters/storage";
import { createBackup, decodeBackup, encodeBackup } from "./backup";

/** How many nightly backups to keep. */
export const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

/** Make a backup, store it, record it, and remove ones older than the newest KEEP. Never throws. */
export async function runBackup(db: PrismaClient, now = new Date()) {
  const key = process.env.BACKUP_KEY?.trim() || null;
  try {
    const b = await createBackup(db, now);
    const buf = encodeBackup(b, key);
    const path = `backups/deedwood-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.dwb`;
    await getStorage().put(path, new Uint8Array(buf), "application/octet-stream");
    const run = await db.backupRun.create({ data: { key: path, bytes: buf.length, tables: Object.keys(b.tables).length, rows: Object.values(b.tables).reduce((n, r) => n + r.length, 0), encrypted: Boolean(key), createdAt: now } });
    const old = await db.backupRun.findMany({ where: { ok: true }, orderBy: { createdAt: "desc" }, skip: KEEP });
    for (const o of old) {
      if (o.key) await getStorage().delete(o.key).catch(() => undefined);
      await db.backupRun.delete({ where: { id: o.id } });
    }
    return run;
  } catch (e) {
    return db.backupRun.create({ data: { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500), createdAt: now } });
  }
}

export async function readBackup(db: PrismaClient, id: string | "latest") {
  const run = id === "latest" ? await db.backupRun.findFirst({ where: { ok: true }, orderBy: { createdAt: "desc" } }) : await db.backupRun.findUnique({ where: { id } });
  if (!run?.key) throw new Error("No backup found");
  const bytes = await getStorage().get(run.key);
  if (!bytes) throw new Error("The backup file is missing from storage");
  return { run, bytes: Buffer.from(bytes), decode: () => decodeBackup(Buffer.from(bytes), process.env.BACKUP_KEY?.trim() || null) };
}
