import { emit } from "@/server/platform/events";
import type { ScopedDb } from "@/server/dal";
import { todayIn } from "@/lib/dates";
import { runRecurringForLease } from "@/server/leasing/leases";
import { assessLateFees, lateFeePolicy } from "@/server/leasing/late-fees";
import { audit } from "@/server/audit";
import { advanceMockPayments, runAutopay } from "@/server/payments/service";
import { runRecurringBills } from "@/server/accounting/payables";
import { previousPeriod, runManagementFees } from "@/server/accounting/owners";
import { autoDelist } from "@/server/funnel/listings";
import { expireRenewalOffers } from "@/server/funnel/renewals";

export type NightlyResult = {
  leases: number; charges: number; lateFees: number; ended: number;
  autopay?: { attempted: number; skipped: number; failed: number };
  payments?: { settled: number; failed: number; paidOut: number };
  bills?: number;
  managementFees?: { created: number; totalCents: number };
  delisted?: number;
  renewalsExpired?: number;
  reminders?: number;
  ownerStatements?: number;
  landRecords?: number;
  errors: { leaseId: string; message: string }[];
};

/**
 * The nightly accounting job for one organization:
 *   1. end leases whose move-out date has passed,
 *   2. post recurring charges due through today (prorated, idempotent),
 *   3. assess late fees per the settings resolver (idempotent),
 *   4. settle pending mock payments (real processors report by webhook),
 *   5. run autopay for the month (idempotent per autopay + period),
 *   6. create recurring bills that are due, and charge last month's management fees.
 * Each lease runs in its own transaction so one bad lease can't block the rest.
 */
export async function runNightly(db: ScopedDb, opts: { today?: Date; timezone?: string } = {}): Promise<NightlyResult> {
  const today = opts.today ?? todayIn(opts.timezone ?? "America/New_York");
  const a = { orgId: db.ctx.orgId, userId: null };
  const result: NightlyResult = { leases: 0, charges: 0, lateFees: 0, ended: 0, errors: [] };

  const ending = await db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION"] }, moveOutDate: { lt: today } }, select: { id: true, propertyId: true, moveOutDate: true } });
  if (ending.length) await db.lease.updateMany({ where: { id: { in: ending.map((l) => l.id) } }, data: { status: "ENDED" } });
  for (const l of ending) await emit(db, "lease.ended", { leaseId: l.id, propertyId: l.propertyId, endedOn: l.moveOutDate?.toISOString().slice(0, 10) ?? null });
  result.ended = ending.length;

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
  try {
    result.bills = await runRecurringBills(db, today);
    const fees = await runManagementFees(db, previousPeriod(today));
    result.managementFees = { created: fees.created, totalCents: fees.totalCents };
    result.delisted = await autoDelist(db, today);
    result.renewalsExpired = await expireRenewalOffers(db, today);
  } catch (e) {
    result.errors.push({ leaseId: "accounting", message: e instanceof Error ? e.message : String(e) });
  }
  // 7. rent reminders (after charges and autopay, so balances are current), 8. monthly owner statements.
  try {
    const { sendRentReminders } = await import("@/server/leasing/reminders");
    result.reminders = await sendRentReminders(db, today);
    const { emailOwnerStatements } = await import("@/server/accounting/owner-statements");
    result.ownerStatements = await emailOwnerStatements(db, today);
    // Keep county land records fresh (a few per night; only records older than 90 days).
    if (process.env.PARCELS_PROVIDER !== "off") {
      const { refreshStaleLandRecords } = await import("@/server/rentals/land-records");
      result.landRecords = await refreshStaleLandRecords(db, today);
    }
  } catch (e) {
    result.errors.push({ leaseId: "accounting", message: e instanceof Error ? e.message : String(e) });
  }
  if (result.charges || result.lateFees || result.ended || result.errors.length) {
    await audit(db, { action: "job.nightly", entityType: "Job", actorType: "SYSTEM", after: { today: today.toISOString().slice(0, 10), ...result } });
  }
  return result;
}
