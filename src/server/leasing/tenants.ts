import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { newTenantSchema, type NewTenantInput } from "@/lib/leasing";

export async function createTenant(db: ScopedDb, raw: NewTenantInput): Promise<{ id: string }> {
  const v = newTenantSchema.parse(raw);
  const t = await db.tenant.create({
    data: {
      organizationId: db.ctx.orgId, kind: v.kind,
      firstName: v.kind === "PERSON" ? v.firstName : null, lastName: v.kind === "PERSON" ? v.lastName : null,
      companyName: v.companyName || null, email: v.email ? v.email.toLowerCase() : null, phone: v.phone || null, createdById: db.ctx.userId,
    },
  });
  await audit(db, { action: "tenant.created", entityType: "Tenant", entityId: t.id, after: t });
  return { id: t.id };
}

export async function updateTenant(db: ScopedDb, id: string, raw: NewTenantInput): Promise<void> {
  const v = newTenantSchema.parse(raw);
  const before = await db.tenant.findFirst({ where: { id } });
  if (!before) throw new UserFacingError("Tenant not found");
  const after = await db.tenant.update({
    where: { id },
    data: {
      kind: v.kind, firstName: v.kind === "PERSON" ? v.firstName : null, lastName: v.kind === "PERSON" ? v.lastName : null,
      companyName: v.companyName || null, email: v.email ? v.email.toLowerCase() : null, phone: v.phone || null,
    },
  });
  await audit(db, { action: "tenant.updated", entityType: "Tenant", entityId: id, before, after });
}
