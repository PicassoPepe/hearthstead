/**
 * Demo seed (idempotent). Phase 1 creates the tenancy foundation:
 *  - "Maple & Main Property Co." with one user per built-in role
 *  - "Harbor Light Rentals", a second org (shows the org switcher + proves isolation)
 *  - a few company-level setting overrides and audit entries
 *  - Phase 2: 3 portfolios, 12 properties, 60 units, 9 owners (prisma/seed-rentals.ts)
 *  - Phase 3: 50 leases with 18 months of ledger history (prisma/seed-leasing.ts)
 *  - Phase 4: mock processor, tenant portal login, autopay, online payments (prisma/seed-payments.ts)
 *  - Phase 5: vendors, tasks, work orders, inspection, bill (prisma/seed-maintenance.ts)
 *  - Phase 6: deposits, bills, expenses, fees, distributions, bank feed, reconciliation (prisma/seed-accounting.ts)
 *
 * Every demo password is: Demo1234!x
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionOrganization, purgeOrganizations } from "../src/server/orgs";
import { seedRentals } from "./seed-rentals";
import { seedLeasing } from "./seed-leasing";
import { seedPayments } from "./seed-payments";
import { seedMaintenance } from "./seed-maintenance";
import { seedAccounting } from "./seed-accounting";
import { todayIn } from "../src/lib/dates";

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
  const old = await db.organization.findMany({ where: { slug: { in: ["maple-main", "harbor-light"] } }, select: { id: true } });
  await purgeOrganizations(db, old.map((o) => o.id));
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
  // Phase 2: portfolios, properties, units, owners.
  const rentals = await seedRentals(db, orgId, users["admin@example.com"]!);
  // Maintenance is scoped to the North Side portfolio to demo per-member property access.
  await db.membership.updateMany({ where: { organizationId: orgId, userId: users["maint@example.com"] }, data: { propertyScope: rentals.northSidePropertyIds } });

  // Phase 3: 50 leases with up to 18 months of ledger history.
  const leasing = await seedLeasing(process.env.DATABASE_URL!, orgId, users["admin@example.com"]!, todayIn("America/Chicago"));

  // Phase 4: payments connected, tenant portal login, autopay, online payments.
  await db.user.deleteMany({ where: { email: "tenant@example.com" } });
  const payments = await seedPayments(process.env.DATABASE_ADMIN_URL!, process.env.DATABASE_URL!, orgId, users["admin@example.com"]!, todayIn("America/Chicago"), DEMO_PASSWORD);

  // Phase 5: vendors, tasks, work orders, inspection, a bill from a vendor invoice.
  const maintenance = await seedMaintenance(process.env.DATABASE_URL!, orgId, users, todayIn("America/Chicago"));

  // Phase 6: books — deposits, payables, management fees, distributions, bank feed, reconciliation.
  const books = await seedAccounting(process.env.DATABASE_URL!, orgId, users["admin@example.com"]!, todayIn("America/Chicago"));

  // Admin lands in Maple & Main by default.
  await db.user.update({ where: { id: users["admin@example.com"] }, data: { lastOrgId: orgId } });

  console.log(`Seeded in ${Date.now() - started}ms.`);
  console.log(`  Sign in at http://localhost:3000/login — password for every demo user: ${DEMO_PASSWORD}`);
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(17)} ${p.email}`);
  console.log(`  ${"(2nd org admin)".padEnd(17)} harbor@example.com`);
  console.log(`  Rentals: ${rentals.properties} properties, ${rentals.units} units, ${rentals.owners} owners in 3 portfolios.`);
  console.log(`  Leasing: ${leasing.leases} leases, ${leasing.lateFees} late fees, ${leasing.returned} returned payment(s).`);
  console.log(`  Maintenance: ${maintenance.vendors} vendors, ${maintenance.tasks} tasks (vendor login: vendor@example.com → Ace Plumbing).`);
  console.log(`  Accounting: ${books.deposits} deposits, ${books.bills} bills, ${books.expenses} expenses, ${books.feeRuns} fee runs, ${books.distributions} distributions, ${books.feed} bank-feed lines.`);
  console.log(`  Payments: ${payments.payments} online payments, ${payments.autopays} autopays. Tenant portal: tenant@example.com (${payments.demoTenant}).`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
