/**
 * Demo seed (idempotent). Phase 1 creates the tenancy foundation:
 *  - "Maple & Main Property Co." with one user per built-in role
 *  - "Harbor Light Rentals", a second org (shows the org switcher + proves isolation)
 *  - a few company-level setting overrides and audit entries
 * Later phases extend this file with portfolios, properties, units, leases and history.
 *
 * Every demo password is: Demo1234!x
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionOrganization } from "../src/server/orgs";

const db = new PrismaClient();
export const DEMO_PASSWORD = "Demo1234!x";

const PEOPLE = [
  { email: "admin@example.com", name: "Avery Admin", role: "ADMIN" },
  { email: "pm@example.com", name: "Priya Manager", role: "PROPERTY_MANAGER" },
  { email: "books@example.com", name: "Ben Bookkeeper", role: "BOOKKEEPER" },
  { email: "maint@example.com", name: "Marco Maintenance", role: "MAINTENANCE" },
  { email: "vendor@example.com", name: "Val Vendor (Ace Plumbing)", role: "VENDOR" },
  { email: "owner@example.com", name: "Olivia Owner", role: "OWNER_READONLY" },
] as const;

async function main(): Promise<void> {
  const started = Date.now();
  // Reset demo data (cascades through memberships, roles, settings, audit logs).
  await db.organization.deleteMany({ where: { slug: { in: ["maple-main", "harbor-light"] } } });
  await db.user.deleteMany({ where: { email: { in: [...PEOPLE.map((p) => p.email), "harbor@example.com", "invitee@example.com"] } } });
  await db.emailMessage.deleteMany({});

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users: Record<string, string> = {};
  for (const p of PEOPLE) {
    const u = await db.user.create({ data: { email: p.email, name: p.name, passwordHash, emailVerified: new Date() } });
    users[p.email] = u.id;
  }

  const { orgId } = await provisionOrganization(db, { name: "Maple & Main Property Co.", slug: "maple-main", ownerUserId: users["admin@example.com"]! });
  await db.organization.update({
    where: { id: orgId },
    data: { email: "office@maplemain.example", timezone: "America/Chicago" },
  });
  const roles = await db.role.findMany({ where: { organizationId: orgId } });
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;

  for (const p of PEOPLE.filter((x) => x.role !== "ADMIN")) {
    await db.membership.create({
      data: { organizationId: orgId, userId: users[p.email]!, roleId: roleId(p.role), status: "ACTIVE", acceptedAt: new Date(), createdById: users["admin@example.com"] },
    });
  }

  // A pending invitation.
  const invitee = await db.user.create({ data: { email: "invitee@example.com", name: "Isaac Invitee" } });
  await db.membership.create({
    data: { organizationId: orgId, userId: invitee.id, roleId: roleId("PROPERTY_MANAGER"), status: "INVITED", invitedAt: new Date(), createdById: users["admin@example.com"] },
  });

  // Company-level setting overrides (the rest inherit built-in defaults).
  const overrides: [string, unknown][] = [
    ["lateFees.graceDays", 3],
    ["lateFees.amountCents", 7500],
    ["applications.feeCents", 5000],
  ];
  for (const [key, value] of overrides) {
    await db.setting.create({ data: { organizationId: orgId, scope: "ORG", scopeId: orgId, key, value: value as never, createdById: users["admin@example.com"] } });
  }
  await db.auditLog.createMany({
    data: overrides.map(([key, value]) => ({
      organizationId: orgId, actorId: users["admin@example.com"], action: "setting.updated", entityType: "Setting", entityId: `ORG:${orgId}:${key}`, after: value as never,
    })),
  });

  // Second organization: admin@ belongs to both; harbor@ only to Harbor Light.
  const harborUser = await db.user.create({ data: { email: "harbor@example.com", name: "Hana Harbor", passwordHash, emailVerified: new Date() } });
  const harbor = await provisionOrganization(db, { name: "Harbor Light Rentals", slug: "harbor-light", ownerUserId: harborUser.id });
  const harborPm = await db.role.findFirstOrThrow({ where: { organizationId: harbor.orgId, key: "PROPERTY_MANAGER" } });
  await db.membership.create({ data: { organizationId: harbor.orgId, userId: users["admin@example.com"]!, roleId: harborPm.id, status: "ACTIVE", acceptedAt: new Date() } });
  await db.setting.create({ data: { organizationId: harbor.orgId, scope: "ORG", scopeId: harbor.orgId, key: "lateFees.graceDays", value: 10 } });
  // Admin lands in Maple & Main by default.
  await db.user.update({ where: { id: users["admin@example.com"] }, data: { lastOrgId: orgId } });

  console.log(`Seeded in ${Date.now() - started}ms.`);
  console.log(`  Sign in at http://localhost:3000/login — password for every demo user: ${DEMO_PASSWORD}`);
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(17)} ${p.email}`);
  console.log(`  ${"(2nd org admin)".padEnd(17)} harbor@example.com`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
