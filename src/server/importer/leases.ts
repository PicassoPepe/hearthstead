import type { ScopedDb } from "@/server/dal";
import { audit } from "@/server/audit";
import { parseMoney } from "@/lib/money";
import { addMonths, startOfMonth, toISODate } from "@/lib/dates";
import { leaseWizardSchema, rangesOverlap } from "@/lib/leasing";
import { normalizeDate, type ImportIssue, type ImportResult } from "@/lib/importer";
import { createLeaseInTx, occupiedUntil, type ParsedLease } from "@/server/leasing/leases";
import { AccountResolver } from "@/server/ledger/journal";
import { postCharge, postCredit } from "@/server/leasing/money";

/**
 * Import existing leases. Rent history isn't rebuilt: each lease starts billing on the 1st of
 * next month, the deposit is recorded as received, and the opening balance (what the tenant
 * owes today; negative = credit) posts against Opening Balance Equity.
 */
export async function importLeases(db: ScopedDb, recs: Record<string, string>[], commit: boolean, today: Date): Promise<ImportResult> {
  const issues: ImportIssue[] = [];
  const [properties, rentAcct, active] = await Promise.all([
    db.property.findMany({ include: { units: { where: { deletedAt: null } } } }),
    db.account.findFirst({ where: { systemKey: "RENT_INCOME" } }),
    db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION"] } }, include: { units: true } }),
  ]);
  const byName = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p]));
  const taken: { unitId: string; start: string; end: string | null; row: number }[] = active.flatMap((l) => l.units.map((u) => ({ unitId: u.unitId, start: toISODate(l.startDate), end: occupiedUntil(l), row: 0 })));

  const plans: { row: number; lease: ParsedLease; depositCents: number; openingCents: number }[] = [];
  recs.forEach((r, i) => {
    const row = i + 2;
    const n = issues.length;
    const p = byName.get((r.propertyName ?? "").trim().toLowerCase());
    if (!p) issues.push({ row, field: "propertyName", message: `No property named "${r.propertyName ?? ""}"` });
    const unit = p?.units.find((u) => u.name.trim().toLowerCase() === (r.unitName ?? "").trim().toLowerCase());
    if (p && !unit) issues.push({ row, field: "unitName", message: `${p.name} has no unit "${r.unitName ?? ""}"` });
    const start = normalizeDate(r.startDate ?? "");
    if (!start) issues.push({ row, field: "startDate", message: `"${r.startDate ?? ""}" isn't a date` });
    const end = r.endDate ? normalizeDate(r.endDate) : null;
    if (r.endDate && !end) issues.push({ row, field: "endDate", message: `"${r.endDate}" isn't a date` });
    const rentRaw = (r.rent ?? "").trim();
    const rent = rentRaw ? parseMoney(rentRaw) : 0;
    if (rentRaw && (!rent || rent <= 0)) issues.push({ row, field: "rent", message: `"${r.rent ?? ""}" isn't a valid rent` });
    const deposit = r.deposit ? parseMoney(r.deposit) : 0;
    if (deposit == null || deposit < 0) issues.push({ row, field: "deposit", message: `"${r.deposit}" isn't a valid amount` });
    const opening = r.openingBalance ? parseMoney(r.openingBalance) : 0;
    if (opening == null) issues.push({ row, field: "openingBalance", message: `"${r.openingBalance}" isn't a valid amount` });
    if (issues.length > n || !p || !unit || !start || (rent && !rentAcct)) return;

    const parsed = leaseWizardSchema.safeParse({
      status: "ACTIVE", propertyId: p.id, unitIds: [unit.id], termType: end ? "FIXED" : "MONTH_TO_MONTH", startDate: start, endDate: end ?? "",
      tenants: [{ newTenant: { kind: "PERSON", firstName: r.firstName ?? "", lastName: r.lastName ?? "", email: r.email ?? "", phone: r.phone ?? "" }, role: "PRIMARY" }],
      recurring: rent && rentAcct ? [{ kind: "RENT" as const, accountId: rentAcct.id, description: "Rent", amountCents: rent }] : [],
      deposit: { amountCents: deposit ?? 0, handling: deposit ? "RECEIVED" : "NONE" },
    });
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        const f = String(iss.path.at(-1) ?? "");
        issues.push({ row, field: f === "firstName" || f === "lastName" || f === "email" ? f : f === "endDate" ? "endDate" : undefined, message: iss.message });
      }
      return;
    }
    const clash = taken.find((t) => t.unitId === unit.id && rangesOverlap(start, end, t.start, t.end));
    if (clash) {
      issues.push({ row, field: "unitName", message: clash.row ? `Overlaps row ${clash.row} for the same unit` : `${p.name} · ${unit.name} already has an active lease for these dates` });
      return;
    }
    taken.push({ unitId: unit.id, start, end, row });
    plans.push({ row, lease: parsed.data, depositCents: deposit ?? 0, openingCents: opening ?? 0 });
  });

  const summary = `${recs.length} lease${recs.length === 1 ? "" : "s"} with tenants`;
  if (issues.length || !commit) return { ok: issues.length === 0, issues, summary };

  const a = { orgId: db.ctx.orgId, userId: db.ctx.userId };
  const billFrom = startOfMonth(addMonths(today, 1));
  await db.tx(
    async (tx) => {
      const obe = await new AccountResolver(tx).id("OPENING_BALANCE_EQUITY");
      for (const p of plans) {
        const leaseId = await createLeaseInTx(tx, a, p.lease, today, { billFrom, depositDate: today });
        if (p.openingCents > 0) await postCharge(tx, a, { leaseId, accountId: obe, amountCents: p.openingCents, date: today, memo: "Opening balance", chargeKind: "OPENING_BALANCE" });
        if (p.openingCents < 0) await postCredit(tx, a, { leaseId, accountId: obe, amountCents: -p.openingCents, date: today, memo: "Opening credit balance" });
      }
    },
    { timeout: 120_000 },
  );
  await audit(db, { action: "import.leases", entityType: "Import", after: { summary, rows: recs.length } });
  return { ok: true, issues: [], summary, created: { leases: plans.length, tenants: plans.length } };
}

