import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { parseISODate } from "@/lib/dates";
import { vendorSchema, type VendorInput } from "@/lib/maintenance";

function data(v: ReturnType<typeof vendorSchema.parse>) {
  return {
    name: v.name,
    contactName: v.contactName || null,
    email: v.email ? v.email.toLowerCase() : null,
    phone: v.phone || null,
    trades: v.trades,
    taxIdLast4: v.taxIdLast4 || null,
    send1099: v.send1099,
    w9OnFile: v.w9OnFile,
    insuranceExpires: v.insuranceExpires ? parseISODate(v.insuranceExpires) : null,
  };
}

export async function saveVendor(db: ScopedDb, id: string | null, raw: VendorInput): Promise<{ id: string }> {
  const v = vendorSchema.parse(raw);
  if (id) {
    const before = await db.vendor.findFirst({ where: { id } });
    if (!before) throw new UserFacingError("Vendor not found");
    const after = await db.vendor.update({ where: { id }, data: data(v) });
    await audit(db, { action: "vendor.updated", entityType: "Vendor", entityId: id, before, after });
    return { id };
  }
  const created = await db.vendor.create({ data: { organizationId: db.ctx.orgId, ...data(v), createdById: db.ctx.userId } });
  await audit(db, { action: "vendor.created", entityType: "Vendor", entityId: created.id, after: created });
  return { id: created.id };
}

export async function archiveVendor(db: ScopedDb, id: string, archived: boolean) {
  if (archived && (await db.task.count({ where: { vendorId: id, status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING"] } } }))) {
    throw new UserFacingError("This vendor has open work orders. Reassign or close them first.");
  }
  const r = await db.vendor.updateMany({ where: { id, deletedAt: archived ? null : { not: null } }, data: { deletedAt: archived ? new Date() : null } });
  if (!r.count) throw new UserFacingError("Vendor not found");
  await audit(db, { action: archived ? "vendor.archived" : "vendor.restored", entityType: "Vendor", entityId: id });
}
