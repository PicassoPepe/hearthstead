import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { storeAttachment } from "@/server/records/service";

/**
 * Vendor-submitted invoices. A vendor (Vendor role, linked to a Vendor record) submits an invoice
 * — optionally for one of their work orders, with the PDF attached. Staff review it: approving
 * creates the bill (which may then need owner approval); rejecting sends a note back.
 */
export async function vendorForUser(db: ScopedDb, userId: string) {
  return db.vendor.findFirst({ where: { userId, deletedAt: null } });
}

export async function submitVendorInvoice(db: ScopedDb, vendorId: string, v: { invoiceNumber: string; invoiceDate: string; amountCents: number; description: string; taskId?: string | null }, file: File | null) {
  if (!v.invoiceNumber.trim()) throw new UserFacingError("Enter your invoice number", { invoiceNumber: "Required" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.invoiceDate)) throw new UserFacingError("Enter the invoice date", { invoiceDate: "Required" });
  if (!Number.isSafeInteger(v.amountCents) || v.amountCents <= 0) throw new UserFacingError("Enter the amount", { amountCents: "Required" });
  if (!v.description.trim()) throw new UserFacingError("Describe the work", { description: "Required" });
  let propertyId: string | null = null;
  if (v.taskId) {
    const t = await db.task.findFirst({ where: { id: v.taskId, vendorId } });
    if (!t) throw new UserFacingError("Choose one of your work orders", { taskId: "Not yours" });
    if (t.billId || (await db.vendorInvoice.findFirst({ where: { taskId: t.id, status: { in: ["SUBMITTED", "APPROVED"] } } }))) throw new UserFacingError("This work order is already invoiced", { taskId: "Already invoiced" });
    propertyId = t.propertyId;
  }
  if (await db.vendorInvoice.findFirst({ where: { vendorId, invoiceNumber: v.invoiceNumber.trim(), status: { not: "REJECTED" } } })) throw new UserFacingError("You already submitted that invoice number", { invoiceNumber: "Duplicate" });
  let attachmentId: string | null = null;
  if (file && file.size) {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new UserFacingError("Attach a PDF, PNG or JPG", { file: "Wrong file type" });
    attachmentId = (await storeAttachment(db, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, v.taskId ? { type: "Task", id: v.taskId } : null, "Invoice")).id;
  }
  const inv = await db.vendorInvoice.create({ data: { organizationId: db.ctx.orgId, vendorId, taskId: v.taskId || null, propertyId, invoiceNumber: v.invoiceNumber.trim(), invoiceDate: new Date(`${v.invoiceDate}T00:00:00Z`), amountCents: v.amountCents, description: v.description.trim(), attachmentId, createdById: db.ctx.userId } });
  await audit(db, { action: "vendor_invoice.submitted", entityType: "VendorInvoice", entityId: inv.id, after: { vendorId, amountCents: v.amountCents, taskId: v.taskId } });
  const { notifyModule } = await import("@/server/notifications/service");
  const vendor = await db.vendor.findFirst({ where: { id: vendorId } });
  await notifyModule(db, "accounting", { kind: "payment", title: `Invoice from ${vendor?.name ?? "a vendor"}: $${(v.amountCents / 100).toFixed(2)}`, body: v.description.slice(0, 120), href: "/app/accounting/bills?tab=invoices" }, propertyId);
  return inv;
}

export async function approveVendorInvoice(db: ScopedDb, id: string, v: { accountId: string; propertyId?: string | null; dueDate: string }) {
  const inv = await db.vendorInvoice.findFirst({ where: { id } });
  if (!inv) throw new UserFacingError("Invoice not found");
  if (inv.status !== "SUBMITTED") throw new UserFacingError(`Already ${inv.status.toLowerCase()}`);
  const { createBill } = await import("@/server/maintenance/bills");
  const propertyId = v.propertyId || inv.propertyId;
  const task = inv.taskId ? await db.task.findFirst({ where: { id: inv.taskId } }) : null;
  const bill = await createBill(db, {
    vendorId: inv.vendorId, billNumber: inv.invoiceNumber, billDate: inv.invoiceDate.toISOString().slice(0, 10), dueDate: v.dueDate, memo: inv.description.slice(0, 200),
    lines: [{ accountId: v.accountId, amountCents: inv.amountCents, description: inv.description.slice(0, 200), propertyId: propertyId ?? null, unitId: task?.unitId ?? null }],
    taskId: task && !task.billId ? task.id : null,
  }, task ? { userId: db.ctx.userId, name: "Accounting", kind: "STAFF" } : undefined);
  if (inv.attachmentId) await db.attachment.update({ where: { id: inv.attachmentId }, data: { entityType: "Bill", entityId: bill.id } }).catch(() => undefined);
  await db.vendorInvoice.update({ where: { id }, data: { status: "APPROVED", billId: bill.id, reviewedAt: new Date(), reviewedById: db.ctx.userId } });
  await audit(db, { action: "vendor_invoice.approved", entityType: "VendorInvoice", entityId: id, after: { billId: bill.id } });
  return bill;
}

export async function rejectVendorInvoice(db: ScopedDb, id: string, note: string) {
  const inv = await db.vendorInvoice.findFirst({ where: { id } });
  if (!inv) throw new UserFacingError("Invoice not found");
  if (inv.status !== "SUBMITTED") throw new UserFacingError(`Already ${inv.status.toLowerCase()}`);
  if (note.trim().length < 3) throw new UserFacingError("Tell the vendor why", { note: "Required" });
  await db.vendorInvoice.update({ where: { id }, data: { status: "REJECTED", reviewNote: note.trim(), reviewedAt: new Date(), reviewedById: db.ctx.userId } });
  const vendor = await db.vendor.findFirst({ where: { id: inv.vendorId } });
  if (vendor?.userId) {
    const { notifyUsers } = await import("@/server/notifications/service");
    await notifyUsers(db, [vendor.userId], { kind: "payment", title: `Invoice #${inv.invoiceNumber} was returned`, body: note.trim(), href: "/app/invoices" });
  }
  await audit(db, { action: "vendor_invoice.rejected", entityType: "VendorInvoice", entityId: id, after: { note } });
}
