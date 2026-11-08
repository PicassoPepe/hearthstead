import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { addDays, formatDate, parseISODate, startOfMonth, toISODate } from "@/lib/dates";

/**
 * Editing recurring charges without rewriting history. Periods already posted stay as they were:
 * a change takes effect on or after the next unposted period. Internally a change ends the current
 * charge the day before and starts a new one — both prorate, so a mid-month change bills exactly.
 */

const isoOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function load(db: ScopedDb, id: string) {
  const rc = await db.recurringCharge.findFirst({ where: { id }, include: { lease: true, runs: { select: { id: true }, take: 1 } } });
  if (!rc) throw new UserFacingError("Charge not found");
  if (["ENDED", "CANCELLED"].includes(rc.lease.status)) throw new UserFacingError("This lease has ended.");
  return rc;
}

/** Earliest date a change can take effect: the start of the next period that hasn't posted. */
export function earliestEffective(rc: { nextRunDate: Date; startDate: Date }, hasRuns: boolean) {
  return hasRuns ? rc.nextRunDate : rc.startDate;
}

export async function addRecurringCharge(db: ScopedDb, leaseId: string, v: { kind: "RENT" | "OTHER"; accountId: string; description: string; amountCents: number; startDate: string; endDate?: string | null }) {
  const lease = await db.lease.findFirst({ where: { id: leaseId } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (["ENDED", "CANCELLED"].includes(lease.status)) throw new UserFacingError("This lease has ended.");
  if (!v.description.trim()) throw new UserFacingError("Describe the charge", { description: "Required" });
  if (!Number.isInteger(v.amountCents) || v.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Must be more than $0" });
  if (!isoOk(v.startDate)) throw new UserFacingError("Choose a start date", { startDate: "Required" });
  const start = parseISODate(v.startDate);
  const end = v.endDate ? parseISODate(v.endDate) : null;
  if (end && end < start) throw new UserFacingError("End date is before the start date", { endDate: "Before start" });
  if (start < lease.startDate) throw new UserFacingError("Starts before the lease does", { startDate: "Before lease start" });
  const account = await db.account.findFirst({ where: { id: v.accountId, type: { in: ["INCOME", "LIABILITY"] } } });
  if (!account) throw new UserFacingError("Choose an income account", { accountId: "Required" });
  const rc = await db.recurringCharge.create({ data: { organizationId: db.ctx.orgId, leaseId, kind: v.kind, accountId: account.id, description: v.description.trim(), amountCents: v.amountCents, startDate: start, endDate: end, nextRunDate: startOfMonth(start), createdById: db.ctx.userId } });
  await audit(db, { action: "recurring_charge.created", entityType: "Lease", entityId: leaseId, after: { id: rc.id, description: rc.description, amountCents: rc.amountCents, startDate: v.startDate } });
  return rc;
}

/** Change the amount (and optionally description) from `effectiveDate` on. */
export async function changeRecurringCharge(db: ScopedDb, id: string, v: { amountCents: number; effectiveDate: string; description?: string }) {
  const rc = await load(db, id);
  if (!Number.isInteger(v.amountCents) || v.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Must be more than $0" });
  if (!isoOk(v.effectiveDate)) throw new UserFacingError("Choose when it takes effect", { effectiveDate: "Required" });
  const eff = parseISODate(v.effectiveDate);
  const earliest = earliestEffective(rc, rc.runs.length > 0);
  if (eff < earliest) throw new UserFacingError(`Charges through ${formatDate(addDays(earliest, -1))} have already posted — choose ${formatDate(earliest)} or later.`, { effectiveDate: `On or after ${formatDate(earliest)}` });
  if (rc.endDate && eff > rc.endDate) throw new UserFacingError("This charge ends before that date", { effectiveDate: "After the charge ends" });
  const description = v.description?.trim() || rc.description;
  // Nothing posted yet and the change starts with the charge: just edit it.
  if (!rc.runs.length && eff <= rc.startDate) {
    await db.recurringCharge.update({ where: { id }, data: { amountCents: v.amountCents, description } });
    await audit(db, { action: "recurring_charge.updated", entityType: "Lease", entityId: rc.leaseId, before: { amountCents: rc.amountCents }, after: { amountCents: v.amountCents } });
    return { id };
  }
  const created = await db.tx(async (tx) => {
    await tx.recurringCharge.update({ where: { id }, data: { endDate: addDays(eff, -1) } });
    return tx.recurringCharge.create({ data: { organizationId: db.ctx.orgId, leaseId: rc.leaseId, kind: rc.kind, accountId: rc.accountId, description, amountCents: v.amountCents, frequency: rc.frequency, startDate: eff, endDate: rc.endDate, nextRunDate: startOfMonth(eff), createdById: db.ctx.userId } });
  });
  await audit(db, { action: "recurring_charge.changed", entityType: "Lease", entityId: rc.leaseId, before: { id, amountCents: rc.amountCents }, after: { id: created.id, amountCents: v.amountCents, effectiveDate: v.effectiveDate } });
  return { id: created.id };
}

/** Stop a charge after `endDate` (the last day billed). Never-posted charges are removed. */
export async function endRecurringCharge(db: ScopedDb, id: string, endDate: string) {
  const rc = await load(db, id);
  if (!isoOk(endDate)) throw new UserFacingError("Choose the last day to bill", { endDate: "Required" });
  const end = parseISODate(endDate);
  if (!rc.runs.length && end < rc.startDate) {
    await db.recurringCharge.update({ where: { id }, data: { deletedAt: new Date() } });
  } else {
    const minEnd = addDays(rc.nextRunDate, -1);
    if (rc.runs.length && end < minEnd) throw new UserFacingError(`Already billed through ${formatDate(minEnd)}. Choose that date or later, then credit the tenant if needed.`, { endDate: `On or after ${formatDate(minEnd)}` });
    await db.recurringCharge.update({ where: { id }, data: { endDate: end } });
  }
  await audit(db, { action: "recurring_charge.ended", entityType: "Lease", entityId: rc.leaseId, after: { id, endDate } });
}

// ─── Bulk rent increase ────────────────────────────────────────────────────

export type IncreaseInput = { leaseIds: string[]; mode: "PERCENT" | "AMOUNT"; value: number; effectiveDate: string; roundToCents?: number; notify?: boolean };
export type IncreaseLine = { leaseId: string; label: string; tenant: string | null; chargeId: string; currentCents: number; newCents: number; error: string | null };

function newAmount(cur: number, mode: IncreaseInput["mode"], value: number, round: number) {
  const raw = mode === "PERCENT" ? cur * (1 + value / 100) : cur + value;
  const r = Math.max(1, round);
  return Math.max(0, Math.round(raw / r) * r);
}

/** Preview: each lease's rent charge active on the effective date, current → new. */
export async function previewIncrease(db: ScopedDb, v: IncreaseInput): Promise<IncreaseLine[]> {
  if (!isoOk(v.effectiveDate)) throw new UserFacingError("Choose an effective date", { effectiveDate: "Required" });
  if (!Number.isFinite(v.value) || v.value === 0) throw new UserFacingError("Enter the increase", { value: "Required" });
  if (v.mode === "PERCENT" && Math.abs(v.value) > 50) throw new UserFacingError("Use an increase between −50% and 50%", { value: "Too large" });
  const eff = parseISODate(v.effectiveDate);
  const leases = await db.lease.findMany({
    where: { id: { in: v.leaseIds.slice(0, 500) }, status: { in: ["ACTIVE", "EVICTION", "DRAFT"] } },
    include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } }, tenants: { where: { role: "PRIMARY" }, include: { tenant: true }, take: 1 }, recurring: { where: { kind: "RENT", deletedAt: null }, include: { runs: { select: { id: true }, take: 1 } }, orderBy: { startDate: "desc" } } },
  });
  return leases.map((l) => {
    const label = `${l.property.name}${l.units.length ? ` · ${l.units.map((u) => u.unit.name).join(", ")}` : ""}`;
    const t = l.tenants[0]?.tenant;
    const tenant = t ? (t.companyName || `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) : null;
    const rc = l.recurring.find((r) => r.startDate <= eff && (!r.endDate || r.endDate >= eff)) ?? l.recurring.find((r) => r.startDate > eff);
    if (!rc) return { leaseId: l.id, label, tenant, chargeId: "", currentCents: 0, newCents: 0, error: "No rent charge on that date" };
    const earliest = earliestEffective(rc, rc.runs.length > 0);
    const newCents = newAmount(rc.amountCents, v.mode, v.value, v.roundToCents ?? 100);
    const error = eff < earliest ? `Rent already posted — earliest ${formatDate(earliest)}` : l.endDate && eff > l.endDate ? "Lease ends before then" : newCents <= 0 ? "New rent would be $0" : null;
    return { leaseId: l.id, label, tenant, chargeId: rc.id, currentCents: rc.amountCents, newCents, error };
  });
}

export async function applyIncrease(db: ScopedDb, v: IncreaseInput) {
  const lines = (await previewIncrease(db, v)).filter((l) => !l.error);
  if (!lines.length) throw new UserFacingError("None of the selected leases can take this increase — check the effective date.");
  for (const l of lines) await changeRecurringCharge(db, l.chargeId, { amountCents: l.newCents, effectiveDate: v.effectiveDate });
  let notified = 0;
  if (v.notify) {
    const { startConversation } = await import("@/server/comms/service");
    const author = { userId: db.ctx.userId, name: "Leasing office" };
    for (const l of lines) {
      const tenants = await db.leaseTenant.findMany({ where: { leaseId: l.leaseId, role: { not: "COSIGNER" } }, include: { tenant: true } });
      for (const lt of tenants.filter((x) => x.tenant.email)) {
        try {
          await startConversation(db, { tenantId: lt.tenantId }, { channel: "EMAIL", author, subject: "Rent change notice", body: `Hi ${lt.tenant.firstName ?? "there"}, this is notice that rent for ${l.label} will change from $${(l.currentCents / 100).toFixed(2)} to $${(l.newCents / 100).toFixed(2)} per month starting ${formatDate(parseISODate(v.effectiveDate))}. Questions? Just reply.` });
          notified++;
        } catch { /* missing contact info — skip */ }
      }
    }
  }
  await audit(db, { action: "rent.bulk_increase", entityType: "Lease", after: { leases: lines.length, mode: v.mode, value: v.value, effectiveDate: v.effectiveDate, notified } });
  return { updated: lines.length, notified, effectiveDate: toISODate(parseISODate(v.effectiveDate)) };
}
