import type { Discount, LeaseTransaction } from "@prisma/client";
import type { ScopedTx } from "@/server/dal";
import { discountAmount, inWindow, NEVER_DISCOUNTED } from "@/lib/discounts";
import { postDiscountCredit, type Actor } from "@/server/leasing/money";

/**
 * Applies landlord discounts to lease charges. Runs inside the caller's transaction:
 *  - postCharge() calls applyDiscountsToCharge() for every new charge;
 *  - activating a discount (created without approval, approved, or a code redeemed) calls
 *    applyDiscountToLease() for charges already posted inside its window.
 * Each discount touches each charge at most once (unique discountId+chargeId), and the total
 * of all discounts on a charge never exceeds the charge (it can't go below $0).
 */

const kindOf = (c: { chargeKind: string | null }) => c.chargeKind ?? "OTHER";

async function leaseScope(tx: ScopedTx, leaseId: string) {
  const l = await tx.lease.findFirst({ where: { id: leaseId }, select: { propertyId: true, units: { select: { unitId: true } } } });
  return { propertyId: l?.propertyId ?? null, unitIds: new Set(l?.units.map((u) => u.unitId) ?? []) };
}

function covers(d: Discount, c: Pick<LeaseTransaction, "chargeKind" | "date">, scope: { propertyId: string | null; unitIds: Set<string> }) {
  if (NEVER_DISCOUNTED.has(kindOf(c))) return false;
  if (d.target !== "CHARGE_KINDS") return false;
  if (d.chargeKinds.length && !d.chargeKinds.includes(kindOf(c))) return false;
  if (d.propertyId && d.propertyId !== scope.propertyId) return false;
  if (d.unitId && !scope.unitIds.has(d.unitId)) return false;
  return inWindow(d, c.date);
}

/** A credit can't be dated inside closed books; use today then. */
async function creditDate(tx: ScopedTx, chargeDate: Date) {
  const org = await tx.organization.findFirst({ select: { booksClosedThrough: true } });
  if (org?.booksClosedThrough && chargeDate <= org.booksClosedThrough) return new Date(new Date().toISOString().slice(0, 10));
  return chargeDate;
}

/** Post one discount on one charge. Returns the cents taken off (0 when nothing was left to discount). */
export async function applyOne(tx: ScopedTx, a: Actor, d: Discount, c: LeaseTransaction): Promise<number> {
  if (await tx.discountApplication.findFirst({ where: { discountId: d.id, chargeId: c.id } })) return 0;
  const already = (await tx.discountApplication.aggregate({ where: { chargeId: c.id }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const amount = discountAmount(d, c.amountCents, already);
  if (amount <= 0) return 0;
  const credit = await postDiscountCredit(tx, a, { leaseId: c.leaseId, chargeId: c.id, amountCents: amount, date: await creditDate(tx, c.date), memo: `Discount — ${d.reasonText}${d.name && d.name !== d.reasonText ? ` (${d.name})` : ""}` });
  await tx.discountApplication.create({ data: { organizationId: a.orgId, discountId: d.id, leaseId: c.leaseId, chargeId: c.id, creditId: credit.id, chargeCents: c.amountCents, amountCents: amount, afterCents: c.amountCents - already - amount } });
  await tx.discountEvent.create({ data: { organizationId: a.orgId, discountId: d.id, action: "applied", actorId: a.userId, before: { chargeId: c.id, chargeCents: c.amountCents, alreadyDiscountedCents: already }, after: { creditId: credit.id, discountCents: amount, chargeNowCents: c.amountCents - already - amount, ledgerLines: [credit.journalEntryId] } } });
  return amount;
}

/** Active discounts that reach this lease: given directly to it, or a code it redeemed. */
async function discountsForLease(tx: ScopedTx, leaseId: string) {
  const redeemed = (await tx.discountRedemption.findMany({ where: { leaseId }, select: { discountId: true } })).map((r) => r.discountId);
  return tx.discount.findMany({
    where: { status: "ACTIVE", revokedAt: null, target: "CHARGE_KINDS", OR: [{ leaseId }, { id: { in: redeemed } }] },
    orderBy: { createdAt: "asc" },
  });
}

/** Called for every newly posted charge. */
export async function applyDiscountsToCharge(tx: ScopedTx, a: Actor, c: LeaseTransaction) {
  if (c.type !== "CHARGE" || NEVER_DISCOUNTED.has(kindOf(c))) return 0;
  const list = await discountsForLease(tx, c.leaseId);
  if (!list.length) return 0;
  const scope = await leaseScope(tx, c.leaseId);
  let total = 0;
  for (const d of list) {
    if (!covers(d, c, scope)) continue;
    if (d.duration === "ONCE" && (await tx.discountApplication.count({ where: { discountId: d.id, leaseId: c.leaseId } }))) continue;
    total += await applyOne(tx, a, d, c);
  }
  return total;
}

/** When a discount becomes active for a lease: catch up on charges already posted in its window. */
export async function applyDiscountToLease(tx: ScopedTx, a: Actor, d: Discount, leaseId: string) {
  if (d.status !== "ACTIVE" || d.revokedAt) return 0;
  if (d.target === "SINGLE_CHARGE") {
    const c = d.chargeId ? await tx.leaseTransaction.findFirst({ where: { id: d.chargeId, leaseId, type: "CHARGE", voidedAt: null } }) : null;
    return c ? applyOne(tx, a, d, c) : 0;
  }
  const scope = await leaseScope(tx, leaseId);
  const charges = await tx.leaseTransaction.findMany({ where: { leaseId, type: "CHARGE", voidedAt: null, date: { gte: d.startDate, ...(d.endDate ? { lte: d.endDate } : {}) } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  let total = 0;
  for (const c of charges) {
    if (!covers(d, c, scope)) continue;
    if (d.duration === "ONCE" && (await tx.discountApplication.count({ where: { discountId: d.id, leaseId } }))) break;
    total += await applyOne(tx, a, d, c);
  }
  return total;
}
