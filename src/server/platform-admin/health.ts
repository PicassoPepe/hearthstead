import "server-only";
import IORedis from "ioredis";
import { adminDb } from "@/server/db";
import { getStorage } from "@/adapters/storage";

export type Health = { name: string; status: "ok" | "down" | "off"; detail: string };

async function timed<T>(fn: () => Promise<T>) {
  const t = Date.now();
  const v = await fn();
  return { v, ms: Date.now() - t };
}

/** Quick probes for /admin/health: database, Redis, file storage, webhooks, background jobs. */
export async function healthChecks(): Promise<Health[]> {
  const out: Health[] = [];
  try {
    const { ms } = await timed(() => adminDb.$queryRaw`SELECT 1`);
    out.push({ name: "Database", status: "ok", detail: `answered in ${ms} ms` });
  } catch (e) {
    out.push({ name: "Database", status: "down", detail: e instanceof Error ? e.message.slice(0, 200) : "error" });
  }
  if (process.env.REDIS_URL) {
    const r = new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    r.on("error", () => undefined);
    try {
      await r.connect();
      const { ms } = await timed(() => r.ping());
      out.push({ name: "Redis (shared limits, job queue)", status: "ok", detail: `answered in ${ms} ms` });
    } catch {
      out.push({ name: "Redis (shared limits, job queue)", status: "down", detail: "can't connect" });
    } finally {
      r.disconnect();
    }
  } else out.push({ name: "Redis (shared limits, job queue)", status: "off", detail: "not configured — single-server mode" });
  try {
    const s = getStorage();
    const key = `health/${Date.now()}.txt`;
    await s.put(key, new TextEncoder().encode("ok"), "text/plain");
    const back = await s.get(key);
    await s.delete(key).catch(() => undefined);
    out.push({ name: "File storage", status: back ? "ok" : "down", detail: back ? "write + read OK" : "could not read back" });
  } catch (e) {
    out.push({ name: "File storage", status: "down", detail: e instanceof Error ? e.message.slice(0, 200) : "error" });
  }
  const since = new Date(Date.now() - 86_400_000);
  const failed = await adminDb.webhookDelivery.count({ where: { status: "FAILED", createdAt: { gte: since } } }).catch(() => 0);
  out.push({ name: "Webhooks (24 h)", status: failed > 20 ? "down" : "ok", detail: `${failed} failed deliveries` });
  const last = await adminDb.auditLog.findFirst({ where: { actorType: "SYSTEM" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null);
  out.push({ name: "Background jobs", status: last && Date.now() - last.createdAt.getTime() < 3 * 86_400_000 ? "ok" : "off", detail: last ? `last system activity ${last.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "no system activity recorded yet" });
  const lastBackup = await adminDb.backupRun.findFirst({ orderBy: { createdAt: "desc" } }).catch(() => null);
  out.push(!lastBackup
    ? { name: "Backups", status: "off", detail: "no backup yet — the first runs tonight (or press Back up now)" }
    : !lastBackup.ok
      ? { name: "Backups", status: "down", detail: `last backup failed: ${lastBackup.error ?? "unknown error"}` }
      : { name: "Backups", status: Date.now() - lastBackup.createdAt.getTime() < 36 * 3_600_000 ? "ok" : "down", detail: `last backup ${lastBackup.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · ${Math.round(lastBackup.bytes / 1024)} KB${lastBackup.encrypted ? " · encrypted" : " · not encrypted (set BACKUP_KEY)"}` });
  const errSince = new Date(Date.now() - 86_400_000);
  const errors = await adminDb.errorEvent.count({ where: { createdAt: { gte: errSince } } }).catch(() => 0);
  out.push({ name: "Errors (24 h)", status: errors > 25 ? "down" : "ok", detail: `${errors} unexpected error${errors === 1 ? "" : "s"}${process.env.PLATFORM_ALERT_EMAIL ? " · alerts on" : " · set PLATFORM_ALERT_EMAIL for alert emails"}` });
  if (process.env.ERROR_TRACKER_URL) out.push({ name: "Error tracker", status: "ok", detail: process.env.ERROR_TRACKER_URL });
  return out;
}
