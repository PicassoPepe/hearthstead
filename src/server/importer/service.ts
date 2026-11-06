import type { ScopedDb } from "@/server/dal";
import { audit } from "@/server/audit";
import { parseMoney } from "@/lib/money";
import { parseBaths, PROPERTY_TYPE_META, US_STATES, ownerSchema, type PropertyTypeKey } from "@/lib/rentals";
import { parsePropertyType, type ImportIssue, type ImportKind, type ImportResult } from "@/lib/importer";

export const MAX_IMPORT_ROWS = 5000;

type UnitRec = { row: number; name: string; beds: number | null; bathsTenths: number | null; sqft: number | null; marketRentCents: number };
type PropertyGroup = {
  key: string;
  name: string;
  existingId: string | null;
  type: PropertyTypeKey;
  address: { addressLine1: string; city: string; state: string; postalCode: string };
  portfolio: string;
  units: UnitRec[];
};

const intField = (v: string, row: number, field: string, issues: ImportIssue[]): number | null => {
  if (!v) return null;
  const n = v.replace(/,/g, "");
  if (!/^\d+$/.test(n)) {
    issues.push({ row, field, message: `"${v}" isn't a whole number` });
    return null;
  }
  return Number(n);
};

async function planProperties(db: ScopedDb, recs: Record<string, string>[]) {
  const issues: ImportIssue[] = [];
  const existing = await db.property.findMany({ include: { units: { where: { deletedAt: null }, select: { name: true } } } });
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const groups = new Map<string, PropertyGroup>();

  recs.forEach((r, i) => {
    const row = i + 2; // header is row 1
    const name = r.propertyName ?? "";
    if (!name) return void issues.push({ row, field: "propertyName", message: "Property name is required" });
    const key = name.toLowerCase();
    const match = byName.get(key);
    let g = groups.get(key);
    if (!g) {
      const type = (match?.type ?? parsePropertyType(r.type ?? "")) as PropertyTypeKey | null;
      if (!type) issues.push({ row, field: "type", message: `Unknown property type "${r.type ?? ""}"` });
      const state = (r.state ?? "").toUpperCase();
      if (!match) {
        if (!r.addressLine1) issues.push({ row, field: "addressLine1", message: "Street address is required" });
        if (!r.city) issues.push({ row, field: "city", message: "City is required" });
        if (!(US_STATES as readonly string[]).includes(state)) issues.push({ row, field: "state", message: `"${r.state ?? ""}" isn't a US state code` });
        if (!/^\d{5}(-\d{4})?$/.test(r.postalCode ?? "")) issues.push({ row, field: "postalCode", message: `"${r.postalCode ?? ""}" isn't a valid ZIP` });
      }
      g = {
        key,
        name,
        existingId: match?.id ?? null,
        type: type ?? "MULTI_FAMILY",
        address: { addressLine1: r.addressLine1 ?? "", city: r.city ?? "", state, postalCode: r.postalCode ?? "" },
        portfolio: r.portfolio ?? "",
        units: [],
      };
      groups.set(key, g);
    }
    const unitName = r.unitName || (PROPERTY_TYPE_META[g.type].singleUnit ? "Main" : "");
    if (!unitName) return void issues.push({ row, field: "unitName", message: "Unit name is required" });
    const taken = new Set([...(match?.units.map((u) => u.name.toLowerCase()) ?? []), ...g.units.map((u) => u.name.toLowerCase())]);
    if (taken.has(unitName.toLowerCase())) issues.push({ row, field: "unitName", message: `Unit "${unitName}" already exists at ${name}` });
    const bathsTenths = r.baths ? parseBaths(r.baths) : null;
    if (r.baths && bathsTenths == null) issues.push({ row, field: "baths", message: `"${r.baths}" isn't a number like 1 or 1.5` });
    const rent = r.marketRent ? parseMoney(r.marketRent) : 0;
    if (rent == null || rent < 0) issues.push({ row, field: "marketRent", message: `"${r.marketRent}" isn't a valid amount` });
    g.units.push({
      row,
      name: unitName,
      beds: intField(r.beds ?? "", row, "beds", issues),
      bathsTenths,
      sqft: intField(r.sqft ?? "", row, "sqft", issues),
      marketRentCents: rent ?? 0,
    });
  });

  for (const g of groups.values()) {
    const existingCount = g.existingId ? (existing.find((p) => p.id === g.existingId)?.units.length ?? 0) : 0;
    if (PROPERTY_TYPE_META[g.type].singleUnit && existingCount + g.units.length > 1) {
      issues.push({ row: g.units[0]?.row ?? 0, field: "unitName", message: `${g.name} is single-family and can only have one unit` });
    }
  }
  return { groups: [...groups.values()], issues };
}

async function importProperties(db: ScopedDb, recs: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  const { groups, issues } = await planProperties(db, recs);
  const newProps = groups.filter((g) => !g.existingId).length;
  const units = groups.reduce((s, g) => s + g.units.length, 0);
  const summary = `${newProps} new propert${newProps === 1 ? "y" : "ies"}, ${units} unit${units === 1 ? "" : "s"}${groups.length - newProps ? ` (${groups.length - newProps} existing propert${groups.length - newProps === 1 ? "y" : "ies"} get new units)` : ""}`;
  if (issues.length || !commit) return { ok: issues.length === 0, issues, summary };

  const orgId = db.ctx.orgId;
  const userId = db.ctx.userId;
  const opCash = await db.account.findFirst({ where: { systemKey: "OPERATING_CASH" } });
  const depCash = await db.account.findFirst({ where: { systemKey: "DEPOSIT_CASH" } });
  await db.tx(
    async (tx) => {
      const portfolios = new Map((await tx.portfolio.findMany()).map((p) => [p.name.toLowerCase(), p.id]));
      for (const g of groups) {
        let portfolioId: string | null = null;
        if (g.portfolio) {
          portfolioId = portfolios.get(g.portfolio.toLowerCase()) ?? null;
          if (!portfolioId) {
            portfolioId = (await tx.portfolio.create({ data: { organizationId: orgId, name: g.portfolio, createdById: userId } })).id;
            portfolios.set(g.portfolio.toLowerCase(), portfolioId);
          }
        }
        const propertyId =
          g.existingId ??
          (
            await tx.property.create({
              data: {
                organizationId: orgId,
                name: g.name,
                type: g.type,
                portfolioId,
                ...g.address,
                defaultOperatingAccountId: opCash?.id ?? null,
                defaultDepositAccountId: depCash?.id ?? null,
                createdById: userId,
              },
            })
          ).id;
        await tx.unit.createMany({
          data: g.units.map((u) => ({ organizationId: orgId, propertyId, name: u.name, beds: u.beds, bathsTenths: u.bathsTenths, sqft: u.sqft, marketRentCents: u.marketRentCents, createdById: userId })),
        });
      }
    },
    { timeout: 60_000 },
  );
  await audit(db, { action: "import.properties", entityType: "Import", after: { summary, rows: recs.length } });
  return { ok: true, issues: [], summary, created: { properties: newProps, units } };
}

async function importOwners(db: ScopedDb, recs: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  const issues: ImportIssue[] = [];
  const parsed = recs.map((r, i) => {
    const kind = r.companyName && !(r.firstName && r.lastName) ? "COMPANY" : "PERSON";
    const res = ownerSchema.safeParse({ kind, ...r, state: (r.state ?? "").toUpperCase(), taxIdType: "", taxIdLast4: "", send1099: true });
    if (!res.success) for (const iss of res.error.issues) issues.push({ row: i + 2, field: String(iss.path[0] ?? ""), message: iss.message });
    return res.success ? res.data : null;
  });
  const summary = `${recs.length} owner${recs.length === 1 ? "" : "s"}`;
  if (issues.length || !commit) return { ok: issues.length === 0, issues, summary };
  await db.tx(async (tx) => {
    await tx.owner.createMany({
      data: parsed.filter((p): p is NonNullable<typeof p> => p !== null).map((v) => ({
        organizationId: db.ctx.orgId,
        kind: v.kind,
        firstName: v.kind === "PERSON" ? v.firstName || null : null,
        lastName: v.kind === "PERSON" ? v.lastName || null : null,
        companyName: v.companyName || null,
        email: v.email ? v.email.toLowerCase() : null,
        phone: v.phone || null,
        addressLine1: v.addressLine1 || null,
        city: v.city || null,
        state: v.state || null,
        postalCode: v.postalCode || null,
        createdById: db.ctx.userId,
      })),
    });
  });
  await audit(db, { action: "import.owners", entityType: "Import", after: { summary } });
  return { ok: true, issues: [], summary, created: { owners: recs.length } };
}

/** Validate (commit=false) or validate-then-write atomically (commit=true). */
export async function runImport(db: ScopedDb, kind: ImportKind, recs: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  if (recs.length === 0) return { ok: false, issues: [{ row: 0, message: "The file has no data rows" }], summary: "Nothing to import" };
  if (recs.length > MAX_IMPORT_ROWS) return { ok: false, issues: [{ row: 0, message: `Import up to ${MAX_IMPORT_ROWS} rows at a time` }], summary: "Too many rows" };
  return kind === "properties" ? importProperties(db, recs, commit) : importOwners(db, recs, commit);
}
