import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { addDays, toISODate } from "@/lib/dates";

export const KEY_KINDS = ["KEY", "FOB", "REMOTE", "PARKING", "STORAGE", "MAILBOX", "OTHER"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];
export const KEY_KIND_LABEL: Record<KeyKind, string> = { KEY: "Key", FOB: "Fob / access card", REMOTE: "Garage remote", PARKING: "Parking space", STORAGE: "Storage unit", MAILBOX: "Mailbox", OTHER: "Other" };
export const isSpace = (k: string) => k === "PARKING" || k === "STORAGE";

export type KeyInput = { kind: KeyKind; label: string; propertyId: string; unitId?: string | null; monthlyFeeCents?: number; notes?: string | null };

/**
 * Keys, fobs, remotes, parking spaces and storage units: who has what. Assigning a paid space to a
 * lease adds a recurring charge (prorated); returning it ends that charge.
 */
export async function saveKeyItem(db: ScopedDb, id: string | null, v: KeyInput) {
  if (!KEY_KINDS.includes(v.kind)) throw new UserFacingError("Choose a type", { kind: "Required" });
  if (!v.label.trim()) throw new UserFacingError("Give it a label", { label: "e.g. P12 or Front door #2" });
  if (!(await db.property.findFirst({ where: { id: v.propertyId } }))) throw new UserFacingError("Choose a property", { propertyId: "Required" });
  if (v.unitId && !(await db.unit.findFirst({ where: { id: v.unitId, propertyId: v.propertyId } }))) throw new UserFacingError("That unit isn't in this property", { unitId: "Pick again" });
  const fee = isSpace(v.kind) ? Math.max(0, Math.round(v.monthlyFeeCents ?? 0)) : 0;
  const data = { kind: v.kind, label: v.label.trim(), propertyId: v.propertyId, unitId: v.unitId || null, monthlyFeeCents: fee, notes: v.notes?.trim() || null };
  if (id) {
    const k = await db.keyItem.findFirst({ where: { id } });
    if (!k) throw new UserFacingError("Not found");
    await db.keyItem.update({ where: { id }, data });
    return { id };
  }
  const dup = await db.keyItem.findFirst({ where: { propertyId: v.propertyId, kind: v.kind, label: data.label } });
  if (dup) throw new UserFacingError("That label is already used at this property", { label: "Already exists" });
  const k = await db.keyItem.create({ data: { organizationId: db.ctx.orgId, createdById: db.ctx.userId, ...data } });
  await audit(db, { action: "key_item.created", entityType: "KeyItem", entityId: k.id, after: data });
  return { id: k.id };
}

export async function assignKeyItem(db: ScopedDb, id: string, v: { leaseId: string; date: string; billFee: boolean }) {
  const k = await db.keyItem.findFirst({ where: { id } });
  if (!k) throw new UserFacingError("Not found");
  if (k.status === "ASSIGNED") throw new UserFacingError("Already assigned — return it first");
  if (k.status === "RETIRED") throw new UserFacingError("This item is retired");
  const lease = await db.lease.findFirst({ where: { id: v.leaseId, status: { in: ["ACTIVE", "EVICTION", "DRAFT"] } }, include: { tenants: { where: { role: "PRIMARY" }, include: { tenant: true }, take: 1 }, units: { include: { unit: { select: { name: true } } } } } });
  if (!lease) throw new UserFacingError("Choose an active lease", { leaseId: "Required" });
  if (lease.propertyId !== k.propertyId) throw new UserFacingError("That lease is at a different property", { leaseId: "Different property" });
  const t = lease.tenants[0]?.tenant;
  let recurringChargeId: string | null = null;
  if (v.billFee && k.monthlyFeeCents > 0) {
    const { addRecurringCharge } = await import("@/server/leasing/recurring");
    const acct = await db.account.findFirst({ where: { OR: [{ systemKey: "OTHER_INCOME" }, { systemKey: "RENT_INCOME" }] }, orderBy: { systemKey: "asc" } });
    const rc = await addRecurringCharge(db, lease.id, { kind: "OTHER", accountId: acct!.id, description: `${k.kind === "PARKING" ? "Parking" : "Storage"} ${k.label}`, amountCents: k.monthlyFeeCents, startDate: v.date });
    recurringChargeId = rc.id;
  }
  await db.keyItem.update({ where: { id }, data: { status: "ASSIGNED", leaseId: lease.id, holderName: t ? (t.companyName || `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim()) : null, assignedAt: new Date(`${v.date}T12:00:00Z`), recurringChargeId } });
  await audit(db, { action: "key_item.assigned", entityType: "KeyItem", entityId: id, after: { leaseId: lease.id, billed: Boolean(recurringChargeId) } });
}

export async function returnKeyItem(db: ScopedDb, id: string, v: { date: string; lost?: boolean }) {
  const k = await db.keyItem.findFirst({ where: { id } });
  if (!k || k.status !== "ASSIGNED") throw new UserFacingError("This item isn't assigned");
  if (k.recurringChargeId && k.leaseId) {
    const rc = await db.recurringCharge.findFirst({ where: { id: k.recurringChargeId } });
    if (rc && (!rc.endDate || rc.endDate > new Date(v.date))) {
      const { endRecurringCharge } = await import("@/server/leasing/recurring");
      // Bill through the return date, or through what's already posted if that's later.
      const minEnd = toISODate(addDays(rc.nextRunDate, -1));
      await endRecurringCharge(db, rc.id, v.date < minEnd ? minEnd : v.date);
    }
  }
  await db.keyItem.update({ where: { id }, data: { status: v.lost ? "LOST" : "AVAILABLE", leaseId: null, holderName: null, assignedAt: null, recurringChargeId: null } });
  await audit(db, { action: v.lost ? "key_item.lost" : "key_item.returned", entityType: "KeyItem", entityId: id, after: { leaseId: k.leaseId, date: v.date } });
}

export async function setKeyStatus(db: ScopedDb, id: string, status: "AVAILABLE" | "RETIRED") {
  const k = await db.keyItem.findFirst({ where: { id } });
  if (!k) throw new UserFacingError("Not found");
  if (k.status === "ASSIGNED") throw new UserFacingError("Return it first");
  await db.keyItem.update({ where: { id }, data: { status } });
}
