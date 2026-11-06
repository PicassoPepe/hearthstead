import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "@/server/dal";
import { runNightly, type NightlyResult } from "./nightly";
import { todayIn } from "@/lib/dates";

/**
 * Runs the nightly job for every organization (system process). Each org runs with a
 * tenant-scoped client, so RLS still applies inside the job.
 */
export async function runNightlyForAllOrgs(opts: { admin: PrismaClient; app: PrismaClient; today?: Date }): Promise<Record<string, NightlyResult>> {
  const orgs = await opts.admin.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true, timezone: true } });
  const out: Record<string, NightlyResult> = {};
  for (const o of orgs) {
    const db = createScopedClient(opts.app, { orgId: o.id, userId: null });
    out[o.name] = await runNightly(db, { today: opts.today ?? todayIn(o.timezone) });
  }
  return out;
}
