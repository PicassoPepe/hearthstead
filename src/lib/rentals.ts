import { z } from "zod";

/** Client-safe rentals vocabulary, validation rules and formatters. */

export const PROPERTY_TYPES = [
  "SINGLE_FAMILY",
  "MULTI_FAMILY",
  "CONDO",
  "TOWNHOME",
  "COMMERCIAL_OFFICE",
  "COMMERCIAL_RETAIL",
  "COMMERCIAL_INDUSTRIAL",
  "HOA",
] as const;
export type PropertyTypeKey = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_META: Record<PropertyTypeKey, { label: string; description: string; residential: boolean; singleUnit: boolean }> = {
  SINGLE_FAMILY: { label: "Single-family home", description: "One house, one unit.", residential: true, singleUnit: true },
  MULTI_FAMILY: { label: "Multi-family", description: "Duplex to apartment complex.", residential: true, singleUnit: false },
  CONDO: { label: "Condo", description: "One or more condo units you manage.", residential: true, singleUnit: false },
  TOWNHOME: { label: "Townhome", description: "Attached homes, one or more units.", residential: true, singleUnit: false },
  COMMERCIAL_OFFICE: { label: "Office", description: "Office suites.", residential: false, singleUnit: false },
  COMMERCIAL_RETAIL: { label: "Retail", description: "Storefronts and retail bays.", residential: false, singleUnit: false },
  COMMERCIAL_INDUSTRIAL: { label: "Industrial", description: "Warehouse, flex and industrial space.", residential: false, singleUnit: false },
  HOA: { label: "HOA / association", description: "Homeowner association you manage.", residential: true, singleUnit: false },
};

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN",
  "MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
] as const;

const optInt = (max: number) => z.number().int().min(0).max(max).nullable().optional();

export const addressSchema = z.object({
  addressLine1: z.string().trim().min(3, "Enter the street address").max(200),
  addressLine2: z.string().trim().max(100).optional().default(""),
  city: z.string().trim().min(2, "Enter the city").max(100),
  state: z.enum(US_STATES, { message: "Choose a state" }),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP"),
});

export const unitInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name the unit").max(60),
  beds: optInt(20),
  bathsTenths: optInt(200),
  sqft: optInt(1_000_000),
  marketRentCents: z.number().int().min(0, "Rent can't be negative").max(100_000_000),
  amenities: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type UnitInput = z.input<typeof unitInputSchema>;

export const ownershipInputSchema = z.object({
  ownerId: z.string().min(1),
  percentBps: z.number().int().min(1, "Must be more than 0%").max(10_000),
  agreementStart: z.string().optional().nullable(),
  agreementEnd: z.string().optional().nullable(),
});

/** The New Property wizard payload, with every business rule from the spec. */
export const propertyWizardSchema = z
  .object({
    type: z.enum(PROPERTY_TYPES, { message: "Choose a property type" }),
    name: z.string().trim().min(2, "Name the property").max(120),
    portfolioId: z.string().optional().nullable(),
    address: addressSchema,
    yearBuilt: z.number().int().min(1700).max(2100).nullable().optional(),
    units: z.array(unitInputSchema).min(1, "Add at least one unit").max(1000),
    defaultOperatingAccountId: z.string().optional().nullable(),
    defaultDepositAccountId: z.string().optional().nullable(),
    reserveCents: z.number().int().min(0).default(0),
    owners: z.array(ownershipInputSchema).default([]),
  })
  .superRefine((v, ctx) => {
    if (PROPERTY_TYPE_META[v.type].singleUnit && v.units.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["units"], message: "A single-family property has exactly one unit." });
    }
    const names = v.units.map((u) => u.name.trim().toLowerCase());
    names.forEach((n, i) => {
      if (names.indexOf(n) !== i) ctx.addIssue({ code: "custom", path: ["units", i, "name"], message: "Unit names must be unique" });
    });
    const ids = v.owners.map((o) => o.ownerId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["owners"], message: "Each owner can be added once" });
    const total = v.owners.reduce((s, o) => s + o.percentBps, 0);
    if (v.owners.length > 0 && total !== 10_000) {
      ctx.addIssue({ code: "custom", path: ["owners"], message: `Ownership must total 100% (currently ${formatPercentBps(total)})` });
    }
  });
export type PropertyWizardInput = z.input<typeof propertyWizardSchema>;

export const propertyEditSchema = z.object({
  name: z.string().trim().min(2, "Name the property").max(120),
  portfolioId: z.string().optional().nullable(),
  address: addressSchema,
  yearBuilt: z.number().int().min(1700).max(2100).nullable().optional(),
  defaultOperatingAccountId: z.string().optional().nullable(),
  defaultDepositAccountId: z.string().optional().nullable(),
  reserveCents: z.number().int().min(0),
});
export type PropertyEditInput = z.input<typeof propertyEditSchema>;

export const ownerSchema = z
  .object({
    kind: z.enum(["PERSON", "COMPANY"]),
    firstName: z.string().trim().max(80).optional().default(""),
    lastName: z.string().trim().max(80).optional().default(""),
    companyName: z.string().trim().max(120).optional().default(""),
    email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
    phone: z.string().trim().max(40).optional().default(""),
    addressLine1: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().max(100).optional().default(""),
    state: z.string().trim().max(2).optional().default(""),
    postalCode: z.string().trim().max(10).optional().default(""),
    taxIdType: z.enum(["", "SSN", "EIN"]).default(""),
    taxIdLast4: z.union([z.literal(""), z.string().regex(/^\d{4}$/, "Last 4 digits only")]).default(""),
    send1099: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "PERSON" && (!v.firstName || !v.lastName)) {
      if (!v.firstName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "Enter a first name" });
      if (!v.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Enter a last name" });
    }
    if (v.kind === "COMPANY" && !v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Enter the company name" });
  });
export type OwnerInput = z.input<typeof ownerSchema>;

export function ownerDisplayName(o: { kind?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
  if (o.kind === "COMPANY" && o.companyName) return o.companyName;
  const n = [o.firstName, o.lastName].filter(Boolean).join(" ");
  return n || o.companyName || "Unnamed owner";
}

export function formatPercentBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/** "62.5" → 6250 bps. Returns null for invalid input. Works on the string (no float math). */
export function parsePercentToBps(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
  return bps <= 10_000 ? bps : null;
}

export function formatBaths(tenths: number | null | undefined): string {
  if (tenths == null) return "—";
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/** "1.5" → 15 tenths. */
export function parseBaths(input: string): number | null {
  const m = /^\s*(\d{1,2})(?:\.(\d))?\s*$/.exec(input);
  return m ? Number(m[1]) * 10 + Number(m[2] ?? 0) : null;
}

export function formatAddress(p: { addressLine1: string; addressLine2?: string | null; city: string; state: string; postalCode: string }): string {
  return `${p.addressLine1}${p.addressLine2 ? `, ${p.addressLine2}` : ""}, ${p.city}, ${p.state} ${p.postalCode}`;
}

/** Suggest the next unit name from the existing ones: "101" → "102", "Unit A" → "Unit B", "3" → "4". */
export function nextUnitName(existing: string[]): string {
  const last = existing[existing.length - 1];
  if (!last) return "1";
  const num = /^(.*?)(\d+)$/.exec(last);
  if (num) {
    const width = num[2]!.length;
    let n = Number(num[2]) + 1;
    let candidate = `${num[1]}${String(n).padStart(width, "0")}`;
    while (existing.includes(candidate)) candidate = `${num[1]}${String(++n).padStart(width, "0")}`;
    return candidate;
  }
  const letter = /^(.*?)([A-Y])$/.exec(last);
  if (letter) return `${letter[1]}${String.fromCharCode(letter[2]!.charCodeAt(0) + 1)}`;
  return `${last} 2`;
}
