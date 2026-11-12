/**
 * Spreadsheet importer: pure, client-safe helpers. Parsing happens in the browser
 * (papaparse / read-excel-file); validation and writes happen on the server.
 */
export type ImportKind = "properties" | "owners" | "leases";

export type ImportField = { key: string; label: string; required?: boolean; synonyms: string[]; example: string; help?: string };

export const IMPORT_SPECS: Record<ImportKind, { title: string; description: string; fields: ImportField[] }> = {
  properties: {
    title: "Properties & units",
    description: "One row per unit. Rows with the same property name become one property; a name that already exists adds units to it.",
    fields: [
      { key: "propertyName", label: "Property name", required: true, synonyms: ["property", "building", "property name", "name"], example: "Maple Court" },
      { key: "type", label: "Property type", synonyms: ["type", "property type", "kind"], example: "Multi-family", help: "Single-family, Multi-family, Condo, Townhome, Office, Retail, Industrial, HOA. Blank becomes multi-family." },
      { key: "addressLine1", label: "Street address", synonyms: ["address", "street", "address 1", "address line 1", "street address"], example: "418 Oak St" },
      { key: "city", label: "City", synonyms: ["city", "town"], example: "Springfield" },
      { key: "state", label: "State", synonyms: ["state", "st", "province"], example: "IL" },
      { key: "postalCode", label: "ZIP", synonyms: ["zip", "zip code", "postal code", "postcode"], example: "62701" },
      { key: "portfolio", label: "Portfolio", synonyms: ["portfolio", "group"], example: "North Side" },
      { key: "unitName", label: "Unit name", synonyms: ["unit", "unit name", "unit number", "unit #", "apt", "suite"], example: "101" },
      { key: "beds", label: "Beds", synonyms: ["beds", "bedrooms", "br", "bed"], example: "2" },
      { key: "baths", label: "Baths", synonyms: ["baths", "bathrooms", "ba", "bath"], example: "1.5" },
      { key: "sqft", label: "Square feet", synonyms: ["sqft", "sq ft", "square feet", "size", "area"], example: "850" },
      { key: "marketRent", label: "Market rent", synonyms: ["rent", "market rent", "asking rent", "monthly rent"], example: "$1,250.00" },
    ],
  },
  leases: {
    title: "Leases, tenants & opening balances",
    description: "One row per lease. Units must already exist. Rent history isn't re-created: the opening balance is what the tenant owes today (negative for a credit), and rent starts posting next month.",
    fields: [
      { key: "propertyName", label: "Property name", required: true, synonyms: ["property", "building", "property name"], example: "Maple Court" },
      { key: "unitName", label: "Unit name", required: true, synonyms: ["unit", "unit name", "unit #", "apt"], example: "101" },
      { key: "firstName", label: "Tenant first name", synonyms: ["first name", "tenant first name", "first"], example: "Jordan" },
      { key: "lastName", label: "Tenant last name", synonyms: ["last name", "tenant last name", "last", "surname"], example: "Lee" },
      { key: "email", label: "Tenant email", synonyms: ["email", "tenant email", "e-mail"], example: "jordan@example.com" },
      { key: "phone", label: "Tenant phone", synonyms: ["phone", "mobile", "cell"], example: "(312) 555-0199" },
      { key: "startDate", label: "Lease start", required: true, synonyms: ["start", "start date", "lease start", "move in", "move-in"], example: "2026-03-01", help: "YYYY-MM-DD or MM/DD/YYYY" },
      { key: "endDate", label: "Lease end", synonyms: ["end", "end date", "lease end", "expiration"], example: "2027-02-28", help: "Blank = month-to-month" },
      { key: "rent", label: "Monthly rent", synonyms: ["rent", "monthly rent", "rent amount"], example: "$1,650.00" },
      { key: "deposit", label: "Deposit held", synonyms: ["deposit", "security deposit", "deposit held"], example: "1650" },
      { key: "openingBalance", label: "Opening balance", synonyms: ["balance", "opening balance", "balance due", "amount owed"], example: "125.00" },
    ],
  },
  owners: {
    title: "Owners",
    description: "One row per owner. Leave first/last name empty and fill Company for companies and trusts.",
    fields: [
      { key: "firstName", label: "First name", synonyms: ["first name", "first", "given name"], example: "Dana" },
      { key: "lastName", label: "Last name", synonyms: ["last name", "last", "surname", "family name"], example: "Whitfield" },
      { key: "companyName", label: "Company", synonyms: ["company", "company name", "business", "entity", "llc"], example: "" },
      { key: "email", label: "Email", synonyms: ["email", "e-mail", "email address"], example: "dana@example.com" },
      { key: "phone", label: "Phone", synonyms: ["phone", "phone number", "mobile", "cell"], example: "(312) 555-0101" },
      { key: "addressLine1", label: "Mailing address", synonyms: ["address", "mailing address", "street"], example: "12 Lake Shore Dr" },
      { key: "city", label: "City", synonyms: ["city"], example: "Chicago" },
      { key: "state", label: "State", synonyms: ["state", "st"], example: "IL" },
      { key: "postalCode", label: "ZIP", synonyms: ["zip", "zip code", "postal code"], example: "60611" },
    ],
  },
};

export type Mapping = Record<string, string | null>; // fieldKey → source header
export type RawRow = Record<string, string>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

/** Suggest a mapping by exact/synonym/contains matching; each header is used at most once. */
export function autoMap(headers: string[], kind: ImportKind): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const f of IMPORT_SPECS[kind].fields) {
    const candidates = [f.label, f.key, ...f.synonyms].map(norm);
    const exact = headers.find((h) => !used.has(h) && candidates.includes(norm(h)));
    const loose = exact ?? headers.find((h) => !used.has(h) && candidates.some((c) => c.length > 3 && norm(h).includes(c)));
    out[f.key] = loose ?? null;
    if (loose) used.add(loose);
  }
  return out;
}

/** Apply a mapping to raw rows → records keyed by field, trimmed strings. Blank rows are dropped. */
export function applyMapping(rows: RawRow[], mapping: Mapping): Record<string, string>[] {
  return rows
    .map((r) => {
      const rec: Record<string, string> = {};
      for (const [field, header] of Object.entries(mapping)) rec[field] = header ? String(r[header] ?? "").trim() : "";
      return rec;
    })
    .filter((rec) => Object.values(rec).some((v) => v !== ""));
}

export function missingRequired(mapping: Mapping, kind: ImportKind): string[] {
  return IMPORT_SPECS[kind].fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}

export function templateCsv(kind: ImportKind): string {
  const fields = IMPORT_SPECS[kind].fields;
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [fields.map((f) => q(f.label)).join(","), fields.map((f) => q(f.example)).join(",")].join("\n") + "\n";
}

const TYPE_ALIASES: Record<string, string> = {
  "single family": "SINGLE_FAMILY", "single-family": "SINGLE_FAMILY", sfr: "SINGLE_FAMILY", house: "SINGLE_FAMILY", "single family home": "SINGLE_FAMILY",
  "multi family": "MULTI_FAMILY", "multi-family": "MULTI_FAMILY", multifamily: "MULTI_FAMILY", apartment: "MULTI_FAMILY", apartments: "MULTI_FAMILY", duplex: "MULTI_FAMILY", triplex: "MULTI_FAMILY", fourplex: "MULTI_FAMILY",
  condo: "CONDO", condominium: "CONDO", townhome: "TOWNHOME", townhouse: "TOWNHOME",
  office: "COMMERCIAL_OFFICE", "commercial office": "COMMERCIAL_OFFICE", retail: "COMMERCIAL_RETAIL", "commercial retail": "COMMERCIAL_RETAIL",
  industrial: "COMMERCIAL_INDUSTRIAL", warehouse: "COMMERCIAL_INDUSTRIAL", "commercial industrial": "COMMERCIAL_INDUSTRIAL",
  hoa: "HOA", association: "HOA",
};

/** Accept "Multi-family", "multi_family", "MULTI_FAMILY", "Apartment"… */
export function parsePropertyType(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const key = s.toUpperCase().replace(/[\s-]+/g, "_");
  const valid = ["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOME", "COMMERCIAL_OFFICE", "COMMERCIAL_RETAIL", "COMMERCIAL_INDUSTRIAL", "HOA"];
  if (valid.includes(key)) return key;
  return TYPE_ALIASES[s.replace(/_/g, " ")] ?? null;
}

export type ImportIssue = { row: number; field?: string; message: string };
export type ImportResult = { ok: boolean; issues: ImportIssue[]; summary: string; created?: Record<string, number> };

/** "2026-03-01", "3/1/2026" or "03/01/26" → "2026-03-01" (null if invalid). */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
