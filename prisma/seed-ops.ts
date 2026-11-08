import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import { assignKeyItem, saveKeyItem, returnKeyItem } from "../src/server/rentals/keys";
import { toISODate } from "../src/lib/dates";

/** Daily-operations demo data: keys, fobs, parking and storage at Maple Court. */
export async function seedOps(appUrl: string, orgId: string, adminId: string, today: Date) {
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const db = createScopedClient(app, { orgId, userId: adminId });
  const maple = await db.property.findFirstOrThrow({ where: { name: "Maple Court" } });
  const leases = await db.lease.findMany({ where: { propertyId: maple.id, status: "ACTIVE" }, orderBy: { startDate: "asc" }, take: 4 });
  const units = await db.unit.findMany({ where: { propertyId: maple.id }, orderBy: { name: "asc" } });
  const day = toISODate(today);
  let n = 0;
  const add = async (kind: "KEY" | "FOB" | "PARKING" | "STORAGE" | "MAILBOX", label: string, extra: { unitId?: string; fee?: number; assignTo?: string; bill?: boolean } = {}) => {
    const { id } = await saveKeyItem(db, null, { kind, label, propertyId: maple.id, unitId: extra.unitId ?? null, monthlyFeeCents: extra.fee ?? 0 });
    if (extra.assignTo) await assignKeyItem(db, id, { leaseId: extra.assignTo, date: day, billFee: extra.bill ?? false });
    n++;
    return id;
  };
  for (let i = 1; i <= 6; i++) await add("PARKING", `P${i}`, { fee: 7_500, assignTo: leases[i - 1]?.id, bill: false });
  await add("STORAGE", "Locker B1", { fee: 3_500, assignTo: leases[0]?.id, bill: false });
  await add("STORAGE", "Locker B2", { fee: 3_500 });
  for (const [i, u] of units.slice(0, 4).entries()) {
    await add("KEY", `${u.name} front door`, { unitId: u.id, assignTo: leases[i]?.id });
    await add("MAILBOX", `Mailbox ${u.name}`, { unitId: u.id, assignTo: leases[i]?.id });
  }
  const lostFob = await add("FOB", "Lobby fob #14", { assignTo: leases[1]?.id });
  await returnKeyItem(db, lostFob, { date: day, lost: true });
  await add("FOB", "Lobby fob #15");

  // Owner approval: Grace asks to approve anything over $1,500 at Cedar Duplex; one roof bill waits.
  const { setSetting } = await import("../src/server/settings/service");
  const { createBill } = await import("../src/server/maintenance/bills");
  const cedar = await db.property.findFirst({ where: { name: "Cedar Duplex" } });
  const roofer = await db.vendor.findFirst({ where: { trades: { has: "ROOFING" } } }) ?? (await db.vendor.findFirstOrThrow({ where: { name: "Ace Plumbing" } }));
  const repairs = await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } });
  if (cedar) {
    await setSetting(db, "ownerPortal.approvalThresholdCents", "PROPERTY", cedar.id, 150_000);
    await createBill(db, { vendorId: roofer.id, billNumber: "R-2207", billDate: day, dueDate: day, memo: "Gutter replacement (front and rear)", lines: [{ accountId: repairs.id, amountCents: 248_000, propertyId: cedar.id }] });
  }
  // A vendor invoice from Ace Plumbing (vendor@example.com) waiting for review.
  const ace = await db.vendor.findFirstOrThrow({ where: { name: "Ace Plumbing" } });
  const { submitVendorInvoice } = await import("../src/server/accounting/vendor-invoices");
  const wo = await db.task.findFirst({ where: { vendorId: ace.id, billId: null } });
  const vdb = createScopedClient(app, { orgId, userId: ace.userId });
  await submitVendorInvoice(vdb, ace.id, { invoiceNumber: "ACE-1043", invoiceDate: day, amountCents: 38_500, description: wo ? `Labor and parts — ${wo.title}` : "Service call and parts", taskId: wo?.id ?? null }, null);
  await app.$disconnect();
  return { keys: n };
}
