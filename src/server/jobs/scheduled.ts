import type { PrismaClient } from "@prisma/client";
import { runBackup } from "@/server/ops/backup-job";
import { recordError } from "@/server/ops/errors";
import { runMinutelyForAllOrgs, runNightlyForAllOrgs } from "./runner";

/** Cloudflare Cron Triggers. Nightly is 02:15 America/Kentucky/Monticello in winter (EST, UTC-5). */
export const MINUTELY_CRON = "* * * * *";
export const NIGHTLY_CRON = "15 7 * * *";
export const NIGHTLY_TZ = "America/Kentucky/Monticello";

export function scheduledJob(cron: string): "minutely" | "nightly" | null {
  if (cron === NIGHTLY_CRON) return "nightly";
  if (cron === MINUTELY_CRON) return "minutely";
  return null;
}

/** Calendar day in Kentucky, so the nightly stamp matches the rent date the job uses. */
export function kentuckyDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NIGHTLY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Minutely: announcements, webhook retries, AI agents.
 * Nightly: backup, then the existing nightly runners. License check-in is skipped — that is only
 * for a computer install. Idempotent via JobRun (Workers have no disk to stamp).
 */
export async function runScheduled(job: "minutely" | "nightly", opts: { admin: PrismaClient; app: PrismaClient }): Promise<{ job: string; ok: boolean; skipped?: boolean; detail?: string }> {
  if (job === "minutely") {
    const sent = await runMinutelyForAllOrgs(opts);
    const day = new Date().toISOString().slice(0, 10);
    await opts.admin.jobRun.upsert({
      where: { name_day: { name: "minutely", day } },
      create: { name: "minutely", day, ok: true, detail: `last ${new Date().toISOString()} sent ${sent}` },
      update: { ok: true, detail: `last ${new Date().toISOString()} sent ${sent}` },
    });
    return { job, ok: true, detail: `sent ${sent}` };
  }

  const day = kentuckyDay();
  const existing = await opts.admin.jobRun.findUnique({ where: { name_day: { name: "nightly", day } } });
  const runningFresh = existing?.detail === "running" && Date.now() - existing.updatedAt.getTime() < 20 * 60_000;
  if (existing?.ok || runningFresh) return { job, ok: true, skipped: true };
  try {
    if (existing) await opts.admin.jobRun.update({ where: { id: existing.id }, data: { ok: false, detail: "running" } });
    else await opts.admin.jobRun.create({ data: { name: "nightly", day, ok: false, detail: "running" } });
  } catch {
    return { job, ok: true, skipped: true };
  }
  try {
    const backup = await runBackup(opts.admin);
    const results = await runNightlyForAllOrgs(opts);
    const detail = JSON.stringify({ backup: backup.ok, orgs: Object.keys(results).length }).slice(0, 500);
    await opts.admin.jobRun.update({ where: { name_day: { name: "nightly", day } }, data: { ok: true, detail } });
    return { job, ok: true, detail };
  } catch (e) {
    const detail = (e instanceof Error ? e.message : "nightly failed").slice(0, 500);
    await opts.admin.jobRun.update({ where: { name_day: { name: "nightly", day } }, data: { ok: false, detail } }).catch(() => undefined);
    await recordError("job", e, { path: "nightly" });
    return { job, ok: false, detail };
  }
}
