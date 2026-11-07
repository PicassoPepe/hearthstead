import type { ScopedDb } from "@/server/dal";
import { todayIn } from "@/lib/dates";
import { runRecurringForLease } from "@/server/leasing/leases";
import { assessLateFees, lateFeePolicy } from "@/server/leasing/late-fees";
import { audit } from "@/server/audit";
import { advanceMockPayments, runAutopay } from "@/server/payments/service";

export type NightlyResult = {
  leases: number; charges: number; lateFees: number; ended: number;
  autopay?: { attempted: number; skipped: number; failed: number };
  payments?: { settled: number; failed: number; paidOut: number };
  errors: { leaseId: string; message: string }[];
};

/**
 * The nightly accounting job for one organization:
 *   1. end leases whose move-out date has passed,
 *   2. post recurring charges due through today (prorated, idempotent),
 *   3. assess late fees per the settings resolver (idempotent),
 *   4. settle pending mock payments (real processors report by webhook),
 *   5. run autopay for the month (idempotent per autopay + period).
 * Each lease runs in its own transaction so one bad lease can't block the rest.
 */
export async function runNightly(db: ScopedDb, opts: { today?: Date; timezone?: string } = {}): Promise<NightlyResult> {
  const today = opts.today ?? todayIn(opts.timezone ?? "America/New_York");
  const a = { orgId: db.ctx.orgId, userId: null };
  const result: NightlyResult = { leases: 0, charges: 0, lateFees: 0, ended: 0, errors: [] };

  const ended = await db.lease.updateMany({ where: { status: { in: ["ACTIVE", "EVICTION"] }, moveOutDate: { lt: today } }, data: { status: "ENDED" } });
  result.ended = ended.count;

  const leases = await db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION"] } }, select: { id: true, propertyId: true } });
  for (const l of leases) {
    try {
      const { policy, order } = await lateFeePolicy(db, l.propertyId, l.id);
      const r = await db.tx(async (tx) => {
        const charges = await runRecurringForLease(tx, a, l.id, today, order);
        const fees = await assessLateFees(tx, a, l.id, policy, today, order);
        return { charges, fees };
      }, { timeout: 60_000 });
      result.leases++;
      result.charges += r.charges;
      result.lateFees += r.fees;
    } catch (e) {
      result.errors.push({ leaseId: l.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  // 4. settle pending mock payments, 5. run autopay (after rent has posted for the month).
  try {
    result.payments = await advanceMockPayments(db, today);
    result.autopay = await runAutopay(db, today);
  } catch (e) {
    result.errors.push({ leaseId: "payments", message: e instanceof Error ? e.message : String(e) });
  }
  if (result.charges || result.lateFees || result.ended || result.errors.length) {
    await audit(db, { action: "job.nightly", entityType: "Job", actorType: "SYSTEM", after: { today: today.toISOString().slice(0, 10), ...result } });
  }
  return result;
}
