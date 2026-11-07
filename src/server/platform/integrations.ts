import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { provisionOrganization, purgeOrganizations } from "@/server/orgs";
import { generateApiKey } from "@/server/api/core";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import { createTask } from "@/server/maintenance/tasks";
import { getAccountingExportProvider, type ExportLine } from "@/adapters/accounting-export";
import { addMonths, parseISODate, startOfMonth, toISODate } from "@/lib/dates";

export async function createApiKey(db: ScopedDb, input: { name: string; scope: "read" | "write"; environment: "live" | "test" }) {
  if (input.name.trim().length < 2) throw new UserFacingError("Name the key (e.g. \"Zapier\")", { name: "Required" });
  if (input.environment === "test") {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId } });
    if (!org.sandboxOrgId) throw new UserFacingError("Create your sandbox first, then add test keys.");
  }
  const k = generateApiKey(input.environment);
  const row = await db.apiKey.create({ data: { organizationId: db.ctx.orgId, name: input.name.trim(), prefix: k.prefix, secretHash: k.secretHash, scope: input.scope, environment: input.environment, createdById: db.ctx.userId } });
  await audit(db, { action: "api_key.created", entityType: "ApiKey", entityId: row.id, after: { name: row.name, scope: row.scope, environment: row.environment, prefix: row.prefix } });
  return { id: row.id, key: k.key };
}

export async function revokeApiKey(db: ScopedDb, id: string) {
  const k = await db.apiKey.findFirst({ where: { id } });
  if (!k) throw new UserFacingError("Key not found");
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, { action: "api_key.revoked", entityType: "ApiKey", entityId: id, after: { prefix: k.prefix } });
}

/**
 * Sandbox: a separate, clearly-labeled organization with sample data that `hs_test_` keys act on.
 * It's fully isolated by the same tenancy rules (organizationId + RLS). Reset rebuilds it.
 */
export async function ensureSandbox(db: ScopedDb, reset = false) {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId } });
  if (org.isSandbox) throw new UserFacingError("This is already a sandbox.");
  if (org.sandboxOrgId && !reset) return org.sandboxOrgId;
  if (org.sandboxOrgId) await purgeOrganizations(adminDb, [org.sandboxOrgId]);
  const owner = db.ctx.userId ?? (await adminDb.membership.findFirstOrThrow({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } })).userId;
  const { orgId } = await provisionOrganization(adminDb, { name: `${org.name} (Sandbox)`, slug: `${org.slug}-sandbox`, ownerUserId: owner });
  await adminDb.organization.update({ where: { id: orgId }, data: { isSandbox: true } });
  await adminDb.organization.update({ where: { id: org.id }, data: { sandboxOrgId: orgId } });
  const sdb = forOrg({ orgId, userId: owner });
  const rent = (await sdb.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const p1 = await createPropertyFromWizard(sdb, { type: "MULTI_FAMILY", name: "Sandbox Apartments", address: { addressLine1: "100 Test Ave", city: "Springfield", state: "IL", postalCode: "62701" }, units: [{ name: "1A", marketRentCents: 120_000 }, { name: "1B", marketRentCents: 125_000 }, { name: "2A", marketRentCents: 130_000 }], owners: [] });
  await createPropertyFromWizard(sdb, { type: "SINGLE_FAMILY", name: "Sandbox House", address: { addressLine1: "7 Example Ln", city: "Springfield", state: "IL", postalCode: "62702" }, units: [{ name: "Main", marketRentCents: 180_000 }], owners: [] });
  const units = await sdb.unit.findMany({ where: { propertyId: p1.id }, orderBy: { name: "asc" } });
  const start = toISODate(startOfMonth(addMonths(new Date(), -2)));
  for (const [i, u] of units.slice(0, 2).entries()) {
    await createLease(sdb, { propertyId: p1.id, unitIds: [u.id], termType: "FIXED", startDate: start, endDate: toISODate(addMonths(parseISODate(start), 12)), rentDueDay: 1, tenants: [{ newTenant: { firstName: ["Test", "Demo"][i]!, lastName: "Tenant", email: `tenant${i + 1}@sandbox.example` }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: u.marketRentCents }], deposit: { amountCents: 0, handling: "NONE" } }, new Date());
  }
  await createTask(sdb, { title: "Sandbox: replace smoke detector batteries", propertyId: p1.id }, { userId: null, name: "Sandbox", kind: "SYSTEM" });
  await audit(db, { action: reset ? "sandbox.reset" : "sandbox.created", entityType: "Organization", entityId: orgId });
  return orgId;
}

/** Ledger lines for a period, flattened for the export provider. */
export async function exportJournal(db: ScopedDb, from: string, to: string, kind?: string) {
  const lines = await db.journalLine.findMany({
    where: { journalEntry: { date: { gte: parseISODate(from), lte: parseISODate(to) } } },
    include: { journalEntry: { select: { id: true, date: true, memo: true, source: true } }, account: { select: { code: true, name: true } } },
    orderBy: [{ journalEntry: { date: "asc" } }, { journalEntryId: "asc" }],
    take: 50_000,
  });
  const props = new Map((await db.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const entryNo = new Map<string, string>();
  const rows: ExportLine[] = lines.map((l) => {
    if (!entryNo.has(l.journalEntryId)) entryNo.set(l.journalEntryId, `HS-${String(entryNo.size + 1).padStart(5, "0")}`);
    return { entryNo: entryNo.get(l.journalEntryId)!, date: toISODate(l.journalEntry.date), memo: l.journalEntry.memo ?? l.journalEntry.source, account: l.account.name, accountCode: l.account.code, debitCents: l.debitCents, creditCents: l.creditCents, property: l.propertyId ? props.get(l.propertyId) ?? null : null };
  });
  const r = await getAccountingExportProvider(kind).export(rows, { from, to });
  await audit(db, { action: "accounting.exported", entityType: "Organization", entityId: db.ctx.orgId, after: { from, to, format: r.format, ...r.summary } });
  return r;
}
