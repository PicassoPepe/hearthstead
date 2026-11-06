import type { Prisma } from "@prisma/client";
import type { ScopedDb, ScopedTx } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { addMonths, maxDate, parseISODate, periodOf, startOfMonth, toISODate, utcDate, daysInMonth } from "@/lib/dates";
import { prorateMonthly, type ApplicationOrder } from "@/server/ledger/math";
import { AccountResolver } from "@/server/ledger/journal";
import { leaseWizardSchema, rangesOverlap, type LeaseWizardInput } from "@/lib/leasing";
import { SETTINGS, isSettingKey } from "@/server/settings/registry";
import { getSettings } from "@/server/settings/service";
import { postCharge, postCredit, recordDeposit, type Actor } from "./money";

const actor = (db: ScopedDb): Actor => ({ orgId: db.ctx.orgId, userId: db.ctx.userId });

export async function applicationOrder(db: ScopedDb, target: { propertyId?: string; leaseId?: string }): Promise<ApplicationOrder> {
  const s = await getSettings(db, ["payments.applicationOrder"], { orgId: db.ctx.orgId, ...target });
  return s["payments.applicationOrder"].value;
}

/** The last day a lease holds its units: move-out date, else a fixed term's end date, else open-ended. */
export function occupiedUntil(l: { moveOutDate: Date | null; endDate: Date | null; termType: string }): string | null {
  if (l.moveOutDate) return toISODate(l.moveOutDate);
  if (l.termType === "FIXED" && l.endDate) return toISODate(l.endDate);
  return null;
}

/** Units on a lease that already have an active (or eviction) lease overlapping the given dates. */
export async function findOverlaps(db: ScopedDb | ScopedTx, unitIds: string[], start: string, end: string | null, excludeLeaseId?: string) {
  const leases = await (db as ScopedDb).lease.findMany({
    where: { status: { in: ["ACTIVE", "EVICTION"] }, units: { some: { unitId: { in: unitIds } } }, ...(excludeLeaseId ? { id: { not: excludeLeaseId } } : {}) },
    include: { units: { include: { unit: { select: { name: true } } } } },
  });
  return leases.filter((l) => rangesOverlap(start, end, toISODate(l.startDate), occupiedUntil(l)));
}

/** Create a lease from the wizard. ACTIVE leases immediately post deposit + catch-up rent. */
export async function createLease(db: ScopedDb, raw: LeaseWizardInput, today: Date): Promise<{ id: string; overlapLeaseId?: string }> {
  const v = leaseWizardSchema.parse(raw);
  const property = await db.property.findFirst({ where: { id: v.propertyId } });
  if (!property) throw new UserFacingError("Choose a property", { propertyId: "Choose a property" });
  const units = await db.unit.findMany({ where: { id: { in: v.unitIds }, propertyId: property.id } });
  if (units.length !== v.unitIds.length) throw new UserFacingError("Choose units at this property", { unitIds: "Choose units at this property" });

  const end = v.endDate || null;
  if (v.status === "ACTIVE") {
    const clash = await findOverlaps(db, v.unitIds, v.startDate, end);
    if (clash.length) {
      const c = clash[0]!;
      throw new UserFacingError(
        `${c.units.map((u) => u.unit.name).join(", ")} already has an active lease starting ${toISODate(c.startDate)}. End that lease (or set its move-out date) first.`,
        { unitIds: `overlap:${c.id}` },
      );
    }
  }
  const accounts = await db.account.findMany({ where: { id: { in: v.recurring.map((r) => r.accountId) } } });
  if (accounts.length !== new Set(v.recurring.map((r) => r.accountId)).size || accounts.some((a) => a.type !== "INCOME")) {
    throw new UserFacingError("Recurring charges post to income accounts", { recurring: "Choose income accounts" });
  }
  const existingTenantIds = v.tenants.flatMap((t) => ("tenantId" in t ? [t.tenantId] : []));
  if (existingTenantIds.length && (await db.tenant.count({ where: { id: { in: existingTenantIds } } })) !== existingTenantIds.length) {
    throw new UserFacingError("One of the tenants no longer exists", { tenants: "Pick tenants again" });
  }
  const overrides = Object.entries(v.overrides).filter(([k]) => isSettingKey(k));
  for (const [k, val] of overrides) {
    if (isSettingKey(k) && !SETTINGS[k].schema.safeParse(val).success) throw new UserFacingError(`Invalid value for ${SETTINGS[k].label}`, { overrides: "Check the overrides" });
  }

  const a = actor(db);
  const start = parseISODate(v.startDate);
  const leaseId = await db.tx(
    async (tx) => {
      const tenantIds: { id: string; role: (typeof v.tenants)[number]["role"] }[] = [];
      for (const t of v.tenants) {
        if ("tenantId" in t) tenantIds.push({ id: t.tenantId, role: t.role });
        else {
          const n = t.newTenant;
          const created = await tx.tenant.create({
            data: {
              organizationId: a.orgId, kind: n.kind,
              firstName: n.kind === "PERSON" ? n.firstName : null, lastName: n.kind === "PERSON" ? n.lastName : null,
              companyName: n.companyName || null, email: n.email ? n.email.toLowerCase() : null, phone: n.phone || null,
              portalStatus: v.portalInvite && n.email ? "INVITED" : "NOT_INVITED", createdById: a.userId,
            },
          });
          tenantIds.push({ id: created.id, role: t.role });
        }
      }
      const lease = await tx.lease.create({
        data: {
          organizationId: a.orgId, propertyId: property.id, status: v.status, termType: v.termType,
          startDate: start, endDate: end ? parseISODate(end) : null, moveInDate: start, rentDueDay: v.rentDueDay,
          depositCents: v.deposit.handling === "NONE" ? 0 : v.deposit.amountCents, createdById: a.userId,
        },
      });
      await tx.leaseUnit.createMany({ data: v.unitIds.map((unitId) => ({ organizationId: a.orgId, leaseId: lease.id, unitId })) });
      await tx.leaseTenant.createMany({ data: tenantIds.map((t) => ({ organizationId: a.orgId, leaseId: lease.id, tenantId: t.id, role: t.role })) });
      if (v.portalInvite) await tx.tenant.updateMany({ where: { id: { in: tenantIds.map((t) => t.id) }, email: { not: null }, portalStatus: "NOT_INVITED" }, data: { portalStatus: "INVITED" } });
      if (v.recurring.length) {
        await tx.recurringCharge.createMany({
          data: v.recurring.map((r) => ({
            organizationId: a.orgId, leaseId: lease.id, kind: r.kind, accountId: r.accountId, description: r.description,
            amountCents: r.amountCents, startDate: start, nextRunDate: startOfMonth(start), createdById: a.userId,
          })),
        });
      }
      for (const [key, value] of overrides) {
        await tx.setting.create({ data: { organizationId: a.orgId, scope: "LEASE", scopeId: lease.id, key, value: value as Prisma.InputJsonValue, createdById: a.userId } });
      }
      if (v.status === "ACTIVE") {
        if (v.deposit.handling === "RECEIVED") await recordDeposit(tx, a, { leaseId: lease.id, amountCents: v.deposit.amountCents, date: start });
        if (v.deposit.handling === "CHARGE") {
          const held = await new AccountResolver(tx).id("DEPOSITS_HELD");
          await postCharge(tx, a, { leaseId: lease.id, accountId: held, amountCents: v.deposit.amountCents, date: start, memo: "Security deposit", chargeKind: "DEPOSIT" });
        }
        await runRecurringForLease(tx, a, lease.id, today);
      }
      return lease.id;
    },
    { timeout: 60_000 },
  );
  await audit(db, { action: "lease.created", entityType: "Lease", entityId: leaseId, after: { ...v } });
  return { id: leaseId };
}

/** Activate a draft lease (overlap rules apply). */
export async function activateLease(db: ScopedDb, leaseId: string, today: Date): Promise<void> {
  const lease = await db.lease.findFirst({ where: { id: leaseId }, include: { units: true } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (lease.status !== "DRAFT") throw new UserFacingError("Only draft leases can be activated");
  if (!(await db.recurringCharge.count({ where: { leaseId, kind: "RENT" } }))) throw new UserFacingError("Add the monthly rent before activating");
  const clash = await findOverlaps(db, lease.units.map((u) => u.unitId), toISODate(lease.startDate), lease.endDate ? toISODate(lease.endDate) : null, leaseId);
  if (clash.length) throw new UserFacingError("Another active lease overlaps these dates. End it first.");
  const a = actor(db);
  await db.tx(async (tx) => {
    await tx.lease.update({ where: { id: leaseId }, data: { status: "ACTIVE" } });
    if (lease.depositCents > 0) {
      const held = await new AccountResolver(tx).id("DEPOSITS_HELD");
      await postCharge(tx, a, { leaseId, accountId: held, amountCents: lease.depositCents, date: lease.startDate, memo: "Security deposit", chargeKind: "DEPOSIT" });
    }
    await runRecurringForLease(tx, a, leaseId, today);
  }, { timeout: 60_000 });
  await audit(db, { action: "lease.activated", entityType: "Lease", entityId: leaseId });
}

/**
 * Move-out / end lease. Recurring charges stop at the move-out date. If rent for the final
 * month was already charged in full, the unused days are credited back (prorated).
 */
export async function endLease(db: ScopedDb, leaseId: string, input: { moveOutDate: string; reason: string; prorate: boolean }, today: Date): Promise<void> {
  const lease = await db.lease.findFirst({ where: { id: leaseId }, include: { recurring: true } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (lease.status === "ENDED") throw new UserFacingError("This lease has already ended");
  const moveOut = parseISODate(input.moveOutDate);
  if (moveOut < lease.startDate) throw new UserFacingError("Move-out can't be before the lease start", { moveOutDate: "Before the lease start" });
  const a = actor(db);
  const order = await applicationOrder(db, { propertyId: lease.propertyId, leaseId });
  await db.tx(async (tx) => {
    await tx.recurringCharge.updateMany({ where: { leaseId }, data: { endDate: moveOut } });
    if (input.prorate && moveOut.getUTCDate() < daysInMonth(moveOut)) {
      for (const rc of lease.recurring.filter((r) => r.kind === "RENT")) {
        const run = await tx.recurringChargeRun.findFirst({ where: { recurringChargeId: rc.id, period: periodOf(moveOut) } });
        if (!run?.transactionId) continue;
        const charged = await tx.leaseTransaction.findFirst({ where: { id: run.transactionId, voidedAt: null } });
        if (!charged) continue;
        const kept = prorateMonthly(rc.amountCents, moveOut, maxDate(rc.startDate, startOfMonth(moveOut)), moveOut).amountCents;
        const back = charged.amountCents - kept;
        if (back > 0) await postCredit(tx, a, { leaseId, amountCents: back, date: moveOut, accountId: rc.accountId, memo: `Prorated rent credit — move-out ${toISODate(moveOut)}`, order });
      }
    }
    await tx.lease.update({
      where: { id: leaseId },
      data: { moveOutDate: moveOut, endDate: moveOut, endedReason: input.reason || null, noticeGivenAt: today, status: moveOut <= today ? "ENDED" : lease.status },
    });
  }, { timeout: 60_000 });
  await audit(db, { action: "lease.move_out", entityType: "Lease", entityId: leaseId, after: input });
}

export async function setEviction(db: ScopedDb, leaseId: string, on: boolean): Promise<void> {
  const lease = await db.lease.findFirst({ where: { id: leaseId } });
  if (!lease) throw new UserFacingError("Lease not found");
  if (on && lease.status !== "ACTIVE") throw new UserFacingError("Only active leases can be moved to eviction");
  if (!on && lease.status !== "EVICTION") throw new UserFacingError("This lease isn't in eviction");
  await db.lease.update({ where: { id: leaseId }, data: { status: on ? "EVICTION" : "ACTIVE" } });
  await audit(db, { action: on ? "lease.eviction_started" : "lease.eviction_cancelled", entityType: "Lease", entityId: leaseId });
}

// ─── Recurring charge engine ──────────────────────────────────────────────

/**
 * Post every due period (nextRunDate ≤ today) for a lease's recurring charges. Idempotent:
 * a unique (recurringChargeId, period) row is claimed before posting, so re-runs post nothing.
 * Partial first/last months are prorated (daily rate = monthly / days in month).
 */
export async function runRecurringForLease(tx: ScopedTx, a: Actor, leaseId: string, today: Date, order?: ApplicationOrder): Promise<number> {
  const lease = await tx.lease.findFirst({ where: { id: leaseId }, include: { recurring: { where: { deletedAt: null } } } });
  if (!lease || !["ACTIVE", "EVICTION"].includes(lease.status)) return 0;
  let posted = 0;
  for (const rc of lease.recurring) {
    let next = rc.nextRunDate;
    while (next <= today && (!rc.endDate || next <= rc.endDate)) {
      const period = periodOf(next);
      const claimed = await tx.recurringChargeRun.createMany({ data: [{ organizationId: a.orgId, recurringChargeId: rc.id, period }], skipDuplicates: true });
      if (claimed.count === 1) {
        const { amountCents, days, daysInMonth: dim } = prorateMonthly(rc.amountCents, next, rc.startDate, rc.endDate);
        if (amountCents > 0) {
          const chargeDate = maxDate(next, rc.startDate);
          const due = maxDate(utcDate(next.getUTCFullYear(), next.getUTCMonth(), lease.rentDueDay), rc.startDate);
          const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(next);
          const t = await postCharge(tx, a, {
            leaseId, accountId: rc.accountId, amountCents, date: chargeDate, dueDate: due,
            memo: `${rc.description} — ${label}${days < dim ? ` (prorated ${days}/${dim} days)` : ""}`,
            chargeKind: rc.kind === "RENT" ? "RENT" : "OTHER", order,
          });
          await tx.recurringChargeRun.update({ where: { recurringChargeId_period: { recurringChargeId: rc.id, period } }, data: { transactionId: t.id } });
          posted++;
        }
      }
      next = startOfMonth(addMonths(next, 1));
    }
    if (next.getTime() !== rc.nextRunDate.getTime()) await tx.recurringCharge.update({ where: { id: rc.id }, data: { nextRunDate: next } });
  }
  return posted;
}
