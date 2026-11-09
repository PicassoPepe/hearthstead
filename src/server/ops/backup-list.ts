import { adminDb } from "@/server/db";

export async function backupRuns(take = 20) {
  const runs = await adminDb.backupRun.findMany({ orderBy: { createdAt: "desc" }, take });
  return runs.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), kb: Math.round(r.bytes / 1024), rows: r.rows, ok: r.ok, error: r.error, encrypted: r.encrypted }));
}
