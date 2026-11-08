import type { ScopedDb, ScopedTx } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/settings/service";
import { getEmailProvider } from "@/adapters";

/**
 * Owner approvals for large expenses. When a bill's amount for a property reaches that property's
 * `ownerPortal.approvalThresholdCents`, an approval request goes to the property's owners (portal +
 * email). The bill can't be paid until an owner approves; a decline blocks it until the bill is voided.
 */
export async function requestApprovalsForBill(db: ScopedDb, billId: string) {
  const bill = await db.bill.findFirst({ where: { id: billId }, include: { lines: true, vendor: true } });
  if (!bill) return 0;
  const byProp = new Map<string, number>();
  for (const l of bill.lines) if (l.propertyId) byProp.set(l.propertyId, (byProp.get(l.propertyId) ?? 0) + l.amountCents);
  let created = 0;
  for (const [propertyId, amount] of byProp) {
    const s = await getSettings(db, ["ownerPortal.approvalThresholdCents"], { orgId: db.ctx.orgId, propertyId });
    const threshold = s["ownerPortal.approvalThresholdCents"].value;
    if (!threshold || amount < threshold) continue;
    const owners = await db.propertyOwnership.findMany({ where: { propertyId, deletedAt: null }, include: { owner: true, property: { select: { name: true } } } });
    if (!owners.length) continue;
    const title = `${bill.vendor.name}${bill.billNumber ? ` invoice #${bill.billNumber}` : ""}${bill.memo ? ` — ${bill.memo}` : ""}`;
    await db.ownerApproval.create({ data: { organizationId: db.ctx.orgId, propertyId, kind: "BILL", entityId: bill.id, title, amountCents: amount } });
    created++;
    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    for (const o of owners.filter((x) => x.owner.email)) {
      await getEmailProvider().send({ to: o.owner.email!, organizationId: db.ctx.orgId, subject: `Approval needed: $${(amount / 100).toFixed(2)} at ${o.property.name}`, text: `${title} for $${(amount / 100).toFixed(2)} at ${o.property.name} needs your approval: ${base}/portal/owner/approvals`, html: `<p style="font-family:system-ui,sans-serif">${title} for <strong>$${(amount / 100).toFixed(2)}</strong> at ${o.property.name} needs your approval.</p><p><a href="${base}/portal/owner/approvals">Review in your owner portal</a></p>` }).catch(() => undefined);
    }
  }
  if (created) await audit(db, { action: "owner_approval.requested", entityType: "Bill", entityId: billId, after: { requests: created } });
  return created;
}

/** Throws if the bill is waiting on (or was declined by) an owner. */
export async function assertBillApproved(tx: ScopedTx | ScopedDb, billId: string) {
  const blocking = await tx.ownerApproval.findFirst({ where: { kind: "BILL", entityId: billId, status: { in: ["PENDING", "DECLINED"] } } });
  if (!blocking) return;
  throw new UserFacingError(blocking.status === "PENDING" ? "This bill is waiting for the owner's approval." : `The owner declined this bill${blocking.note ? `: “${blocking.note}”` : ""}. Void it or talk to the owner.`);
}

/** Owner decides (from the owner portal). Only for properties the owner owns. */
export async function decideApproval(db: ScopedDb, id: string, owner: { name: string; propertyIds: string[] }, decision: "APPROVED" | "DECLINED", note?: string) {
  const a = await db.ownerApproval.findFirst({ where: { id } });
  if (!a || !owner.propertyIds.includes(a.propertyId)) throw new UserFacingError("Request not found");
  if (a.status !== "PENDING") throw new UserFacingError(`Already ${a.status.toLowerCase()}`);
  if (decision === "DECLINED" && !(note ?? "").trim()) throw new UserFacingError("Tell your manager why", { note: "Required" });
  await db.ownerApproval.update({ where: { id }, data: { status: decision, note: note?.trim() || null, decidedAt: new Date(), decidedByName: owner.name } });
  await audit(db, { action: decision === "APPROVED" ? "owner_approval.approved" : "owner_approval.declined", entityType: "OwnerApproval", entityId: id, after: { by: owner.name, viaOwnerPortal: true, note } });
  const { notifyModule } = await import("@/server/notifications/service");
  await notifyModule(db, "accounting", { kind: "system", title: `${owner.name} ${decision === "APPROVED" ? "approved" : "declined"} $${(a.amountCents / 100).toFixed(2)}`, body: a.title, href: `/app/accounting/bills/${a.entityId}` }, a.propertyId);
}
