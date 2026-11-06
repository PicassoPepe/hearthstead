import type { PrismaClient, PropertyType } from "@prisma/client";

/** Deterministic PRNG so the demo data is identical on every seed. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type P = {
  name: string; type: PropertyType; portfolio: string; address: string; city: string; state: string; zip: string; year: number;
  units: { prefix: string; count: number; beds: [number, number]; baths: [number, number]; sqft: [number, number]; rent: [number, number] } | "single";
  owners: [string, number][]; // owner key → percent bps
};

const OWNERS = {
  whitfield: { kind: "PERSON", firstName: "Dana", lastName: "Whitfield", email: "dana.whitfield@example.com", phone: "(312) 555-0101", city: "Chicago", state: "IL", taxIdType: "SSN", taxIdLast4: "4821" },
  okafor: { kind: "PERSON", firstName: "Chidi", lastName: "Okafor", email: "chidi.okafor@example.com", phone: "(312) 555-0102", city: "Evanston", state: "IL", taxIdType: "SSN", taxIdLast4: "1934" },
  nakamura: { kind: "PERSON", firstName: "Emi", lastName: "Nakamura", email: "emi.nakamura@example.com", phone: "(708) 555-0103", city: "Oak Park", state: "IL", taxIdType: "SSN", taxIdLast4: "7710" },
  reyes: { kind: "PERSON", firstName: "Luis", lastName: "Reyes", email: "luis.reyes@example.com", phone: "(312) 555-0104", city: "Chicago", state: "IL", taxIdType: "SSN", taxIdLast4: "3056" },
  lindqvist: { kind: "PERSON", firstName: "Ingrid", lastName: "Lindqvist", email: "ingrid.l@example.com", phone: "(847) 555-0105", city: "Skokie", state: "IL", taxIdType: "SSN", taxIdLast4: "8842" },
  bluestem: { kind: "COMPANY", companyName: "Bluestem Holdings LLC", email: "accounts@bluestem.example.com", phone: "(312) 555-0106", city: "Chicago", state: "IL", taxIdType: "EIN", taxIdLast4: "6612" },
  prairie: { kind: "COMPANY", companyName: "Prairie Light Family Trust", email: "trustee@prairielight.example.com", phone: "(630) 555-0107", city: "Naperville", state: "IL", taxIdType: "EIN", taxIdLast4: "2290" },
  harmon: { kind: "PERSON", firstName: "Grace", lastName: "Harmon", email: "grace.harmon@example.com", phone: "(312) 555-0108", city: "Chicago", state: "IL", taxIdType: "SSN", taxIdLast4: "5547" },
  ironbridge: { kind: "COMPANY", companyName: "Ironbridge Commercial Partners LP", email: "ops@ironbridge.example.com", phone: "(312) 555-0109", city: "Chicago", state: "IL", taxIdType: "EIN", taxIdLast4: "9038" },
} as const;

const PROPERTIES: P[] = [
  { name: "Maple Court", type: "MULTI_FAMILY", portfolio: "North Side", address: "2250 N Maple Ave", city: "Chicago", state: "IL", zip: "60614", year: 1926,
    units: { prefix: "", count: 12, beds: [1, 2], baths: [10, 10], sqft: [620, 940], rent: [1450, 1950] }, owners: [["whitfield", 6000], ["okafor", 4000]] },
  { name: "Oak Terrace Apartments", type: "MULTI_FAMILY", portfolio: "North Side", address: "4417 N Oak Park Ave", city: "Chicago", state: "IL", zip: "60634", year: 1964,
    units: { prefix: "", count: 8, beds: [1, 3], baths: [10, 20], sqft: [700, 1150], rent: [1350, 2100] }, owners: [["bluestem", 10000]] },
  { name: "1418 Birch Lane", type: "SINGLE_FAMILY", portfolio: "North Side", address: "1418 Birch Ln", city: "Evanston", state: "IL", zip: "60201", year: 1951,
    units: "single", owners: [["nakamura", 10000]] },
  { name: "Cedar Duplex", type: "MULTI_FAMILY", portfolio: "North Side", address: "907 W Cedar St", city: "Chicago", state: "IL", zip: "60657", year: 1912,
    units: { prefix: "Unit ", count: 2, beds: [2, 3], baths: [10, 15], sqft: [1050, 1300], rent: [2100, 2450] }, owners: [["reyes", 5000], ["harmon", 5000]] },
  { name: "722 Elm Street", type: "SINGLE_FAMILY", portfolio: "Lakefront", address: "722 Elm St", city: "Oak Park", state: "IL", zip: "60302", year: 1938,
    units: "single", owners: [["lindqvist", 10000]] },
  { name: "Harborview Condos", type: "CONDO", portfolio: "Lakefront", address: "180 E Harbor Dr", city: "Chicago", state: "IL", zip: "60611", year: 2006,
    units: { prefix: "", count: 6, beds: [1, 2], baths: [10, 20], sqft: [780, 1240], rent: [2200, 3100] }, owners: [["prairie", 10000]] },
  { name: "Willow Row Townhomes", type: "TOWNHOME", portfolio: "Lakefront", address: "35 Willow Row", city: "Evanston", state: "IL", zip: "60202", year: 1998,
    units: { prefix: "", count: 6, beds: [3, 3], baths: [25, 25], sqft: [1500, 1700], rent: [2800, 3200] }, owners: [["whitfield", 2500], ["prairie", 7500]] },
  { name: "Lakeshore Fourplex", type: "MULTI_FAMILY", portfolio: "Lakefront", address: "5530 N Sheridan Rd", city: "Chicago", state: "IL", zip: "60640", year: 1929,
    units: { prefix: "", count: 4, beds: [2, 2], baths: [10, 10], sqft: [900, 980], rent: [1650, 1850] }, owners: [["okafor", 10000]] },
  { name: "35 Aspen Court", type: "SINGLE_FAMILY", portfolio: "Lakefront", address: "35 Aspen Ct", city: "Skokie", state: "IL", zip: "60076", year: 1972,
    units: "single", owners: [["harmon", 10000]] },
  { name: "Main Street Retail", type: "COMMERCIAL_RETAIL", portfolio: "Commercial", address: "1200 Main St", city: "Evanston", state: "IL", zip: "60202", year: 1988,
    units: { prefix: "Suite ", count: 4, beds: [0, 0], baths: [10, 10], sqft: [1200, 2400], rent: [2800, 4800] }, owners: [["ironbridge", 10000]] },
  { name: "Commerce Park Office", type: "COMMERCIAL_OFFICE", portfolio: "Commercial", address: "8800 W Commerce Park Dr", city: "Chicago", state: "IL", zip: "60631", year: 2001,
    units: { prefix: "Suite ", count: 8, beds: [0, 0], baths: [10, 20], sqft: [900, 3200], rent: [1900, 6200] }, owners: [["ironbridge", 7000], ["bluestem", 3000]] },
  { name: "Riverside Flex Industrial", type: "COMMERCIAL_INDUSTRIAL", portfolio: "Commercial", address: "4100 S River Rd", city: "Chicago", state: "IL", zip: "60632", year: 1979,
    units: { prefix: "Bay ", count: 7, beds: [0, 0], baths: [10, 10], sqft: [2500, 6000], rent: [2600, 5400] }, owners: [["ironbridge", 10000]] },
];

const AMENITIES = ["In-unit laundry", "Dishwasher", "Balcony", "Central air", "Hardwood floors", "Parking", "Pet friendly", "Storage"];

export async function seedRentals(db: PrismaClient, orgId: string, userId: string) {
  const r = rng(42);
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const roundTo = (n: number, step: number) => Math.round(n / step) * step;

  // Bank details on the default accounts + a separate trust account.
  const op = await db.account.findFirstOrThrow({ where: { organizationId: orgId, systemKey: "OPERATING_CASH" } });
  const dep = await db.account.findFirstOrThrow({ where: { organizationId: orgId, systemKey: "DEPOSIT_CASH" } });
  await db.bankAccount.update({ where: { accountId: op.id }, data: { institution: "Lakeview Community Bank", mask: "4410" } });
  await db.bankAccount.update({ where: { accountId: dep.id }, data: { institution: "Lakeview Community Bank", mask: "7702" } });
  const trust = await db.account.create({ data: { organizationId: orgId, code: "1020", name: "Commercial Trust Account", type: "ASSET", isBank: true, createdById: userId } });
  await db.bankAccount.create({ data: { organizationId: orgId, accountId: trust.id, institution: "Second City Bank", mask: "9135", purpose: "TRUST" } });

  const portfolios: Record<string, string> = {};
  for (const [name, description] of [
    ["North Side", "Residential buildings north of Fullerton"],
    ["Lakefront", "Lakefront and near-north residential"],
    ["Commercial", "Retail, office and industrial"],
  ] as const) {
    portfolios[name] = (await db.portfolio.create({ data: { organizationId: orgId, name, description, createdById: userId } })).id;
  }

  const ownerIds: Record<string, string> = {};
  for (const [key, o] of Object.entries(OWNERS)) {
    const { taxIdType, taxIdLast4, ...rest } = o;
    ownerIds[key] = (
      await db.owner.create({ data: { organizationId: orgId, ...rest, taxInfo: { taxIdType, taxIdLast4, send1099: true }, createdById: userId } })
    ).id;
  }

  let unitCount = 0;
  const northSidePropertyIds: string[] = [];
  const propertyIds: Record<string, string> = {};
  for (const p of PROPERTIES) {
    const prop = await db.property.create({
      data: {
        organizationId: orgId,
        portfolioId: portfolios[p.portfolio],
        name: p.name,
        type: p.type,
        addressLine1: p.address,
        city: p.city,
        state: p.state,
        postalCode: p.zip,
        yearBuilt: p.year,
        defaultOperatingAccountId: p.portfolio === "Commercial" ? trust.id : op.id,
        defaultDepositAccountId: dep.id,
        reserveCents: p.portfolio === "Commercial" ? 500_000 : 250_000,
        createdById: userId,
      },
    });
    propertyIds[p.name] = prop.id;
    if (p.portfolio === "North Side") northSidePropertyIds.push(prop.id);

    const units =
      p.units === "single"
        ? [{ name: "Main", beds: between(3, 4), bathsTenths: [15, 20, 25][between(0, 2)]!, sqft: roundTo(between(1400, 2200), 10), marketRentCents: roundTo(between(2400, 3400), 25) * 100 }]
        : Array.from({ length: p.units.count }, (_, i) => {
            const u = p.units as Exclude<P["units"], "single">;
            const floor = Math.floor(i / 4) + 1;
            const name = u.prefix ? `${u.prefix}${u.prefix.trim() === "Unit" ? String.fromCharCode(65 + i) : 100 + i + 1}` : `${floor}0${(i % 4) + 1}`;
            const beds = between(u.beds[0], u.beds[1]);
            const residential = beds > 0;
            return {
              name,
              beds: residential ? beds : null,
              bathsTenths: residential ? [u.baths[0], u.baths[1]][between(0, 1)]! : null,
              sqft: roundTo(between(u.sqft[0], u.sqft[1]), 10),
              marketRentCents: roundTo(between(u.rent[0], u.rent[1]), 25) * 100,
            };
          });
    await db.unit.createMany({
      data: units.map((u) => ({
        organizationId: orgId,
        propertyId: prop.id,
        ...u,
        amenities: u.beds ? AMENITIES.filter(() => r() < 0.35) : [],
        createdById: userId,
      })),
    });
    unitCount += units.length;

    await db.propertyOwnership.createMany({
      data: p.owners.map(([key, bps]) => ({ organizationId: orgId, propertyId: prop.id, ownerId: ownerIds[key]!, percentBps: bps, agreementStart: new Date(Date.UTC(2023, between(0, 11), 1)), createdById: userId })),
    });
  }

  // A property-level override to demonstrate settings inheritance, plus a few notes.
  await db.setting.create({ data: { organizationId: orgId, scope: "PROPERTY", scopeId: propertyIds["Maple Court"]!, key: "lateFees.graceDays", value: 7, createdById: userId } });
  await db.setting.create({ data: { organizationId: orgId, scope: "PROPERTY", scopeId: propertyIds["Commerce Park Office"]!, key: "payments.passThroughCardFee", value: false, createdById: userId } });
  await db.note.createMany({
    data: [
      { organizationId: orgId, entityType: "Property", entityId: propertyIds["Maple Court"]!, body: "Boiler serviced Oct 2026 by Northwind Mechanical. Next service due Oct 2027.", createdById: userId },
      { organizationId: orgId, entityType: "Property", entityId: propertyIds["Maple Court"]!, body: "Laundry room key is in the lockbox by the rear entrance (code with the office).", createdById: userId },
      { organizationId: orgId, entityType: "Property", entityId: propertyIds["Harborview Condos"]!, body: "HOA requires 48 hours notice before any move-in using the freight elevator.", createdById: userId },
      { organizationId: orgId, entityType: "Owner", entityId: ownerIds.whitfield!, body: "Prefers email. Wants approval for any repair over $750.", createdById: userId },
    ],
  });

  return { properties: PROPERTIES.length, units: unitCount, owners: Object.keys(OWNERS).length, northSidePropertyIds, propertyIds };
}
