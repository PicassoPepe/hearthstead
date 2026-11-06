import type { ScopedDb, ScopedTx } from "@/server/dal";
import { lateFeeFor, type ApplicationOrder, type LateFeePolicy } from "@/server/ledger/math";
import { AccountResolver } from "@/server/ledger/journal";
import { getSettings } from "@/server/settings/service";
import { periodOf, toISODate } from "@/lib/dates";
import { openCharges, postCharge, type Actor } from "./money";

const KEYS = [
  "lateFees.enabled", "lateFees.graceDays", "lateFees.type", "lateFees.amountCents", "lateFees.percentBps",
  "lateFees.maxCents", "lateFees.dailyAccrual", "lateFees.dailyCents", "payments.applicationOrder",
] as const;

/** Resolve the late-fee policy for a lease: lease ?? property ?? org ?? default. */
export async function lateFeePolicy(db: ScopedDb, propertyId: string, leaseId: string): Promise<{ policy: LateFeePolicy; order: ApplicationOrder }> {
  const s = await getSettings(db, KEYS, { orgId: db.ctx.orgId, propertyId, leaseId });
  return {
    policy: {
      enabled: s["lateFees.enabled"].value,
      graceDays: s["lateFees.graceDays"].value,
      type: s["lateFees.type"].value,
      amountCents: s["lateFees.amountCents"].value,
      percentBps: s["lateFees.percentBps"].value,
      maxCents: s["lateFees.maxCents"].value,
      dailyAccrual: s["lateFees.dailyAccrual"].value,
      dailyCents: s["lateFees.dailyCents"].value,
    },
    order: s["payments.applicationOrder"].value,
  };
}

/**
 * Assess late fees for one lease on `today`. Fees are per rent period (the month a rent charge
 * is due). Idempotent: each assessment claims a unique LateFeeRun key first
 * ("2026-11:initial", "2026-11:2026-11-09"), so re-running the job the same day posts nothing.
 */
export async function assessLateFees(tx: ScopedTx, a: Actor, leaseId: string, policy: LateFeePolicy, today: Date, order?: ApplicationOrder): Promise<number> {
  if (!policy.enabled) return 0;
  const open = (await openCharges(tx, leaseId)).filter((c) => c.chargeKind === "RENT");
  if (!open.length) return 0;
  const byPeriod = new Map<string, { due: Date; openCents: number }>();
  for (const c of open) {
    const p = periodOf(c.dueDate);
    const cur = byPeriod.get(p);
    byPeriod.set(p, { due: cur && cur.due < c.dueDate ? cur.due : c.dueDate, openCents: (cur?.openCents ?? 0) + c.remainingCents });
  }
  const runs = await tx.lateFeeRun.findMany({ where: { leaseId } });
  const feeTx = await tx.leaseTransaction.findMany({ where: { id: { in: runs.map((r) => r.transactionId).filter((x): x is string => !!x) }, voidedAt: null }, select: { id: true, amountCents: true } });
  const feeAmount = new Map(feeTx.map((f) => [f.id, f.amountCents]));
  const lateFeeAccount = await new AccountResolver(tx).id("LATE_FEE_INCOME");

  let posted = 0;
  for (const [period, { due, openCents }] of [...byPeriod.entries()].sort()) {
    const mine = runs.filter((r) => r.key.startsWith(`${period}:`));
    const already = mine.reduce((s, r) => s + (r.transactionId ? (feeAmount.get(r.transactionId) ?? 0) : 0), 0);
    const fee = lateFeeFor(policy, { dueDate: due, today, openRentCents: openCents, alreadyAssessedCents: already, initialAssessed: mine.some((r) => r.key.endsWith(":initial")) });
    if (!fee.kind || fee.amountCents <= 0) continue;
    const key = fee.kind === "INITIAL" ? `${period}:initial` : `${period}:${toISODate(today)}`;
    const claimed = await tx.lateFeeRun.createMany({ data: [{ organizationId: a.orgId, leaseId, key }], skipDuplicates: true });
    if (claimed.count === 0) continue;
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(due);
    const t = await postCharge(tx, a, {
      leaseId, accountId: lateFeeAccount, amountCents: fee.amountCents, date: today, dueDate: today,
      memo: fee.kind === "INITIAL" ? `Late fee — ${label} rent` : `Daily late fee — ${label} rent`, chargeKind: "LATE_FEE", order,
    });
    await tx.lateFeeRun.update({ where: { leaseId_key: { leaseId, key } }, data: { transactionId: t.id } });
    posted++;
  }
  return posted;
}
