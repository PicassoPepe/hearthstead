import type { PrismaClient } from "@prisma/client";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "@/server/permissions";
import { slugify } from "@/lib/utils";
import { provisionChart } from "@/server/accounting/chart";

/**
 * System operation (runs with the owner connection): create an organization with its
 * built-in roles and make `ownerUserId` its Admin.
 */
export async function provisionOrganization(
  db: PrismaClient,
  input: { name: string; ownerUserId: string; slug?: string },
): Promise<{ orgId: string; slug: string }> {
  const base = slugify(input.slug ?? input.name) || "org";
  let slug = base;
  for (let i = 2; await db.organization.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.name, slug, createdById: input.ownerUserId },
      });
      const roleIds: Partial<Record<BuiltInRoleKey, string>> = {};
      for (const [key, r] of Object.entries(BUILT_IN_ROLES) as [
        BuiltInRoleKey,
        (typeof BUILT_IN_ROLES)[BuiltInRoleKey],
      ][]) {
        const role = await tx.role.create({
          data: {
            organizationId: org.id,
            key,
            name: r.name,
            description: r.description,
            isSystem: true,
            permissions: r.permissions,
            createdById: input.ownerUserId,
          },
        });
        roleIds[key] = role.id;
      }
      await tx.membership.create({
        data: {
          organizationId: org.id,
          userId: input.ownerUserId,
          roleId: roleIds.ADMIN!,
          status: "ACTIVE",
          acceptedAt: new Date(),
          createdById: input.ownerUserId,
        },
      });
      await provisionChart(tx, org.id, input.ownerUserId);
      await tx.user.update({ where: { id: input.ownerUserId }, data: { lastOrgId: org.id } });
      return { orgId: org.id, slug };
    },
    { timeout: 20_000 },
  );
}

/**
 * System operation: permanently delete organizations and every tenant row they own.
 * Child tables are cleared in foreign-key order. Used by the seed and test cleanup.
 */
const PURGE_ORDER = [
  "PaymentApplication", "LateFeeRun", "RecurringChargeRun", "RecurringCharge", "LeaseTransaction",
  "JournalLine", "JournalEntry", "LeaseTenant", "LeaseUnit", "Lease", "Tenant",
  "PropertyOwnership", "Unit", "Property", "Portfolio", "Owner", "BankAccount", "Account",
  "Note", "Attachment", "Setting", "AuditLog", "EmailMessage", "Membership", "Role",
] as const;

export async function purgeOrganizations(db: PrismaClient, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  await db.$transaction(async (tx) => {
    for (const table of PURGE_ORDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = ANY($1::text[])`, orgIds);
    }
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  }, { timeout: 60_000 });
}
