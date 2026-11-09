import { z } from "zod";
import type { Discount, Prisma } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { can, type PermissionSet } from "@/server/permissions";
import { getSettings } from "@/server/settings/service";
import { CODE_RE, describeDiscount, DISCOUNTABLE_KINDS, monthsEnd, needsApproval, NEVER_DISCOUNTED, normalizeCode, OTHER_REASON } from "@/lib/discounts";
import { parseISODate } from "@/lib/dates";
import { applyDiscountToLease } from "./engine";

/**
 * §2.7a Landlord discounts & concessions.
 * Permission area "discounts": Edit = give discounts, Full = also approve, reject and stop them.
 * Every action writes an append-only DiscountEvent (who, what, before/after, IP) and an audit entry.
 */
export type DiscountActor = { orgId: string; userId: string; name: string; ip: string | null; permissions: PermissionSet };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const discountInput = z.object({
  name: z.string().trim().max(80).optional(),
  kind: z.enum(["PERCENT", "FIXED"]),
  /** PERCENT: basis points (2500 = 25%). FIXED: cents. */
  value: z.number().int(),
  target: z.enum(["SINGLE_CHARGE", "CHARGE_KINDS"]),
  chargeId: z.string().optional(),
  chargeKinds: z.array(z.enum(Object.keys(DISCOUNTABLE_KINDS) as [string, ...string[]])).default([]),
  duration: z.enum(["ONCE", "MONTHS", "DATE_RANGE", "FOREVER"]),
  months: z.number().int().optional(),
  startDate: isoDate,
  endDate: z.union([z.literal(""), isoDate]).optional(),
  delivery: z.enum(["DIRECT", "CODE"]),
  leaseId: z.string().optional(),
  code: z.string().optional(),
  codeExpiresAt: z.union([z.literal(""), isoDate]).optional(),
  maxUses: z.number().int().optional(),
  perTenantLimit: z.number().int().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  reason: z.string().trim(),
  reasonOther: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type DiscountInput = z.input<typeof discountInput>;

const fail = (msg: string, field: string, fieldMsg = msg): never => { throw new UserFacingError(msg, { [field]: fieldMsg }); };

function requireLevel(a: DiscountActor, level: "view" | "edit" | "delete") {
  if (!can(a.permissions, "discounts", level)) throw new UserFacingError(level === "delete" ? "Only someone with Full access to Discounts can do that." : "You don't have permission to give discounts.");
}

export async function discountPolicy(db: ScopedDb) {
  const s = await getSettings(db, ["discounts.reasons", "discounts.approvalOverCents", "discounts.approvalOverPercentBps"], { orgId: db.ctx.orgId });
  return { reasons: s["discounts.reasons"].value, overCents: s["discounts.approvalOverCents"].value, overPercentBps: s["discounts.approvalOverPercentBps"].value };
}

async function event(db: ScopedDb | Prisma.TransactionClient, a: DiscountActor, discountId: string, action: string, v: { reason?: string | null; before?: unknown; after?: unknown } = {}) {
  const j = (x: unknown) => (x === undefined || x === null ? undefined : (JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue));
  await (db as ScopedDb).discountEvent.create({ data: { organizationId: a.orgId, discountId, action, actorId: a.userId, reason: v.reason ?? null, before: j(v.before), after: j(v.after), ip: a.ip } });
}

/** Tell the lease's tenants in their portal inbox. Never blocks the discount itself. */
async function notifyTenants(db: ScopedDb, a: DiscountActor, d: Discount, leaseId: string) {
  try {
    const { startConversation } = await import("@/server/comms/service");
    const people = await db.leaseTenant.findMany({ where: { leaseId }, select: { tenantId: true } });
    const body = `Good news — you have a discount: ${describeDiscount(d)}. Reason: ${d.reasonText}. You'll see it on your account.`;
    for (const p of people) await startConversation(db, { tenantId: p.tenantId }, { body, channel: "PORTAL", author: { userId: a.userId, name: a.name }, subject: "Discount" });
  } catch (e) {
    console.warn("[discounts] tenant notice failed", e);
  }
}

export async function createDiscount(db: ScopedDb, a: DiscountActor, raw: DiscountInput) {
  requireLevel(a, "edit");
  const parsed = discountInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UserFacingError(first?.message ?? "Check the form", first ? { [String(first.path[0])]: first.message } : undefined);
  }
  const v = parsed.data;
  const policy = await discountPolicy(db);

  // Amount
  if (v.kind === "PERCENT" && (v.value <= 0 || v.value > 10_000)) fail("Enter a percent between 0.01 and 100", "value");
  if (v.kind === "FIXED" && v.value <= 0) fail("Enter an amount more than $0.00", "value");

  // Reason (required; "Other" needs words)
  if (!v.reason) fail("Choose a reason", "reason");
  let reasonText = v.reason;
  if (v.reason === OTHER_REASON) {
    if (!v.reasonOther || v.reasonOther.length < 3) fail("Describe the reason", "reasonOther", "Required for Other");
    reasonText = `Other: ${v.reasonOther}`;
  } else if (!policy.reasons.includes(v.reason)) fail("Choose a reason from the list", "reason");

  // When
  const startDate = parseISODate(v.startDate);
  let endDate: Date | null = null;
  let months: number | null = null;
  if (v.duration === "MONTHS") {
    if (!v.months || v.months < 1 || v.months > 60) fail("Enter 1 to 60 months", "months");
    months = v.months!;
    endDate = monthsEnd(startDate, months);
  } else if (v.duration === "DATE_RANGE") {
    if (!v.endDate) fail("Pick an end date", "endDate");
    endDate = parseISODate(v.endDate!);
    if (endDate < startDate) fail("The end date is before the start date", "endDate");
  }

  // Who
  let leaseId: string | null = null;
  let code: string | null = null;
  let propertyId = v.propertyId || null;
  const unitId = v.unitId || null;
  if (v.delivery === "DIRECT") {
    if (!v.leaseId) fail("Choose a lease", "leaseId");
    const lease = await db.lease.findFirst({ where: { id: v.leaseId }, select: { id: true, propertyId: true, status: true } });
    if (!lease) fail("Lease not found", "leaseId");
    leaseId = lease!.id;
    propertyId = lease!.propertyId;
  } else {
    code = normalizeCode(v.code ?? "");
    if (!CODE_RE.test(code)) fail("Codes are 4–24 letters, numbers or dashes", "code");
    if (await db.discount.findFirst({ where: { code } })) fail("That code is already used", "code");
    if (v.maxUses != null && v.maxUses < 1) fail("Use at least 1", "maxUses");
    if (v.perTenantLimit != null && v.perTenantLimit < 1) fail("Use at least 1", "perTenantLimit");
    if (propertyId && !(await db.property.findFirst({ where: { id: propertyId } }))) fail("Property not found", "propertyId");
    if (unitId && !(await db.unit.findFirst({ where: { id: unitId, ...(propertyId ? { propertyId } : {}) } }))) fail("Unit not found", "unitId");
  }

  // What
  let chargeId: string | null = null;
  if (v.target === "SINGLE_CHARGE") {
    if (v.delivery !== "DIRECT") fail("A single-charge discount is given directly to a lease", "target");
    const c = v.chargeId ? await db.leaseTransaction.findFirst({ where: { id: v.chargeId, leaseId: leaseId!, type: "CHARGE", voidedAt: null } }) : null;
    if (!c) fail("Choose the charge to discount", "chargeId");
    if (NEVER_DISCOUNTED.has(c!.chargeKind ?? "OTHER")) fail("Security deposits and opening balances can't be discounted", "chargeId");
    chargeId = c!.id;
  }
  const duration = v.target === "SINGLE_CHARGE" ? "ONCE" : v.duration;

  // Maker-checker: above the owner's threshold, someone with Full access must approve (Full-access users approve their own).
  const pending = needsApproval({ kind: v.kind, value: v.value }, policy) && !can(a.permissions, "discounts", "delete");
  const data = {
    organizationId: a.orgId, name: v.name || reasonText, kind: v.kind, value: v.value, target: v.target, chargeId,
    chargeKinds: v.target === "SINGLE_CHARGE" ? [] : v.chargeKinds, duration, months, startDate, endDate,
    delivery: v.delivery, leaseId, code, codeExpiresAt: v.codeExpiresAt ? new Date(`${v.codeExpiresAt}T23:59:59.000Z`) : null,
    maxUses: v.maxUses ?? null, perTenantLimit: v.perTenantLimit ?? null, propertyId, unitId,
    reasonKey: v.reason, reasonText, notes: v.notes || null,
    status: pending ? "PENDING_APPROVAL" : "ACTIVE", createdById: a.userId,
    ...(pending ? {} : { approvedById: a.userId, approvedAt: new Date() }),
  };
  const { d, applied } = await db.tx(async (tx) => {
    const d = await tx.discount.create({ data });
    await tx.discountEvent.create({ data: { organizationId: a.orgId, discountId: d.id, action: "created", actorId: a.userId, reason: reasonText, after: JSON.parse(JSON.stringify(data)), ip: a.ip } });
    const applied = !pending && d.leaseId ? await applyDiscountToLease(tx, { orgId: a.orgId, userId: a.userId }, d, d.leaseId) : 0;
    return { d, applied };
  });
  await audit(db, { action: pending ? "discount.requested" : "discount.created", entityType: "Discount", entityId: d.id, after: { ...data, appliedCents: applied } });
  if (!pending && d.leaseId) await notifyTenants(db, a, d, d.leaseId);
  return { discount: d, pending, appliedCents: applied };
}

async function load(db: ScopedDb, id: string) {
  const d = await db.discount.findFirst({ where: { id } });
  if (!d) throw new UserFacingError("Discount not found");
  return d;
}

export async function approveDiscount(db: ScopedDb, a: DiscountActor, id: string) {
  requireLevel(a, "delete");
  const d = await load(db, id);
  if (d.status !== "PENDING_APPROVAL") throw new UserFacingError("This discount isn't waiting for approval.");
  if (d.createdById === a.userId) throw new UserFacingError("Someone else has to approve a discount you created.");
  const applied = await db.tx(async (tx) => {
    const n = await tx.discount.update({ where: { id }, data: { status: "ACTIVE", approvedById: a.userId, approvedAt: new Date() } });
    await tx.discountEvent.create({ data: { organizationId: a.orgId, discountId: id, action: "approved", actorId: a.userId, before: { status: d.status }, after: { status: "ACTIVE" }, ip: a.ip } });
    return n.leaseId ? applyDiscountToLease(tx, { orgId: a.orgId, userId: a.userId }, n, n.leaseId) : 0;
  });
  await audit(db, { action: "discount.approved", entityType: "Discount", entityId: id, after: { appliedCents: applied } });
  if (d.leaseId) await notifyTenants(db, a, { ...d, status: "ACTIVE" }, d.leaseId);
  return applied;
}

export async function rejectDiscount(db: ScopedDb, a: DiscountActor, id: string, reason: string) {
  requireLevel(a, "delete");
  const r = reason.trim();
  if (r.length < 3) throw new UserFacingError("Say why", { reason: "Required" });
  const d = await load(db, id);
  if (d.status !== "PENDING_APPROVAL") throw new UserFacingError("This discount isn't waiting for approval.");
  await db.discount.update({ where: { id }, data: { status: "REJECTED", revokedById: a.userId, revokedAt: new Date(), revokeReason: r } });
  await event(db, a, id, "rejected", { reason: r, before: { status: d.status }, after: { status: "REJECTED" } });
  await audit(db, { action: "discount.rejected", entityType: "Discount", entityId: id, after: { reason: r } });
}

/** Stop a discount from now on. What it already took off stays on the books. */
export async function revokeDiscount(db: ScopedDb, a: DiscountActor, id: string, reason: string) {
  requireLevel(a, "delete");
  const r = reason.trim();
  if (r.length < 3) throw new UserFacingError("Say why", { reason: "Required" });
  const d = await load(db, id);
  if (d.status !== "ACTIVE") throw new UserFacingError("Only an active discount can be stopped.");
  await db.discount.update({ where: { id }, data: { status: "REVOKED", revokedById: a.userId, revokedAt: new Date(), revokeReason: r } });
  await event(db, a, id, "revoked", { reason: r, before: { status: "ACTIVE" }, after: { status: "REVOKED" } });
  await audit(db, { action: "discount.revoked", entityType: "Discount", entityId: id, after: { reason: r } });
}

/** A tenant (portal) or staff member enters a code for a lease. */
export async function redeemCode(db: ScopedDb, a: DiscountActor, v: { code: string; leaseId: string; tenantId: string | null }, now = new Date()) {
  const code = normalizeCode(v.code);
  const d = code ? await db.discount.findFirst({ where: { code } }) : null;
  const bad = () => new UserFacingError("That code isn't valid.", { code: "Not valid" });
  if (!d || d.delivery !== "CODE") throw bad();
  if (d.status !== "ACTIVE" || d.revokedAt) throw bad();
  if (d.codeExpiresAt && d.codeExpiresAt < now) throw new UserFacingError("That code has expired.", { code: "Expired" });
  if (d.endDate && d.endDate < new Date(now.toISOString().slice(0, 10))) throw new UserFacingError("That code has expired.", { code: "Expired" });
  const lease = await db.lease.findFirst({ where: { id: v.leaseId }, select: { id: true, propertyId: true, units: { select: { unitId: true } } } });
  if (!lease) throw new UserFacingError("Lease not found");
  if ((d.propertyId && d.propertyId !== lease.propertyId) || (d.unitId && !lease.units.some((u) => u.unitId === d.unitId))) throw new UserFacingError("That code isn't for your home.", { code: "Not for this home" });
  if (await db.discountRedemption.findFirst({ where: { discountId: d.id, leaseId: lease.id } })) throw new UserFacingError("You've already used this code.", { code: "Already used" });
  if (d.maxUses != null && (await db.discountRedemption.count({ where: { discountId: d.id } })) >= d.maxUses) throw new UserFacingError("That code has been used up.", { code: "Used up" });
  if (d.perTenantLimit != null && v.tenantId && (await db.discountRedemption.count({ where: { discountId: d.id, tenantId: v.tenantId } })) >= d.perTenantLimit) throw new UserFacingError("You've already used this code.", { code: "Already used" });
  const applied = await db.tx(async (tx) => {
    await tx.discountRedemption.create({ data: { organizationId: a.orgId, discountId: d.id, leaseId: lease.id, tenantId: v.tenantId, redeemedById: a.userId } });
    await tx.discountEvent.create({ data: { organizationId: a.orgId, discountId: d.id, action: "redeemed", actorId: a.userId, after: { leaseId: lease.id, tenantId: v.tenantId }, ip: a.ip } });
    return applyDiscountToLease(tx, { orgId: a.orgId, userId: a.userId }, d, lease.id);
  });
  await audit(db, { action: "discount.redeemed", entityType: "Discount", entityId: d.id, after: { leaseId: lease.id, tenantId: v.tenantId, appliedCents: applied } });
  return { discount: d, appliedCents: applied, description: describeDiscount(d) };
}

export async function saveDiscountPolicy(db: ScopedDb, a: DiscountActor, v: { reasons: string[]; overCents: number; overPercentBps: number }) {
  requireLevel(a, "delete");
  const { setSetting } = await import("@/server/settings/service");
  const reasons = [...new Set(v.reasons.map((r) => r.trim()).filter((r) => r && r !== OTHER_REASON))];
  if (!reasons.length) throw new UserFacingError("Keep at least one reason", { reasons: "Required" });
  const before = await discountPolicy(db);
  await setSetting(db, "discounts.reasons", "ORG", a.orgId, reasons);
  await setSetting(db, "discounts.approvalOverCents", "ORG", a.orgId, Math.max(0, Math.round(v.overCents)));
  await setSetting(db, "discounts.approvalOverPercentBps", "ORG", a.orgId, Math.min(10_000, Math.max(0, Math.round(v.overPercentBps))));
  await audit(db, { action: "discount.policy_updated", entityType: "Setting", entityId: "discounts", before, after: { reasons, overCents: v.overCents, overPercentBps: v.overPercentBps } });
}
