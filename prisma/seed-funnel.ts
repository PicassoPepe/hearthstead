import { createNodePrisma } from "./node-client.mjs";
import { createScopedClient } from "../src/server/dal";
import * as L from "../src/server/funnel/listings";
import * as A from "../src/server/funnel/applications";
import { ensureDefaultTemplates } from "../src/server/funnel/esign";
import { sendRenewalOffer } from "../src/server/funnel/renewals";
import { addDays, toISODate } from "../src/lib/dates";

/**
 * Phase 9 demo data: templates; listings for vacant units (published with AI descriptions);
 * prospects and showings; applications in every state; a renewal offer out for signature.
 */
export async function seedFunnel(appUrl: string, orgId: string, users: Record<string, string>, today: Date) {
  const app = createNodePrisma(appUrl);
  const pm = users["pm@example.com"]!;
  const db = createScopedClient(app, { orgId, userId: pm });
  await ensureDefaultTemplates(db);

  const leased = new Set((await db.leaseUnit.findMany({ where: { lease: { status: { in: ["ACTIVE", "EVICTION"] } } }, select: { unitId: true } })).map((u) => u.unitId));
  const vacant = (await db.unit.findMany({ where: { deletedAt: null }, include: { property: true }, orderBy: [{ property: { name: "asc" } }, { name: "asc" }] })).filter((u) => !leased.has(u.id) && !u.property.type.startsWith("COMMERCIAL") && u.property.type !== "HOA");
  const listings = [];
  for (const [i, u] of vacant.slice(0, 6).entries()) {
    const petPolicy = i % 2 ? "Cats welcome; dogs under 40 lb with deposit" : "No pets, please";
    const description = await L.describeListing(db, u.id, u.marketRentCents, petPolicy);
    const l = await L.saveListing(db, null, { unitId: u.id, title: `${u.beds ? `${u.beds}-bed` : "Bright"} ${u.property.type === "SINGLE_FAMILY" ? "house" : "apartment"} at ${u.property.name}${u.name !== "Main" ? ` · ${u.name}` : ""}`, description, rentCents: u.marketRentCents, depositCents: u.marketRentCents, availableOn: toISODate(addDays(today, 7 + i * 5)), leaseTermMonths: 12, petPolicy, syndicate: true });
    if (i < 5) await L.setListingStatus(db, l.id, "PUBLISHED");
    listings.push(l);
  }
  const live = listings.slice(0, 5);

  const people = [
    ["Jordan", "Lee", "jordan.lee@example.com", "ZILLOW"], ["Maya", "Patel", "maya.patel@example.com", "WEBSITE"], ["Chris", "Novak", "chris.novak@example.com", "REFERRAL"],
    ["Ana", "Silva", "ana.silva@example.com", "WEBSITE"], ["Theo", "Brooks", "theo.brooks@example.com", "WALK_IN"], ["Priya", "Rao", "priya.rao@example.com", "ZILLOW"],
    ["Sam", "Ortiz", "sam.ortiz@example.com", "PHONE"], ["Lena", "Fischer", "lena.fischer@example.com", "WEBSITE"],
  ] as const;
  const prospects = [];
  for (const [i, [f, l, e, src]] of people.entries()) prospects.push(await L.createProspect(db, { firstName: f, lastName: l, email: e, phone: `(312) 555-02${10 + i}`, source: src, listingId: live[i % live.length]!.id }));
  for (let i = 0; i < 5; i++) {
    const at = new Date(today.getTime() + (i + 1) * 86_400_000 + (15 + (i % 3)) * 3_600_000);
    await L.scheduleShowing(db, { listingId: live[i % live.length]!.id, prospectId: prospects[i]!.id, startsAt: at.toISOString(), source: i % 2 ? "SELF_SCHEDULED" : "STAFF", agentUserId: pm });
  }

  // Applications: strong (submitted), conditional (submitted), declined, in progress.
  const card = { number: "4242424242424242", expMonth: 12, expYear: 2030, cvc: "123" };
  const fill = async (listingId: string, email: string, about: Record<string, string>, income: string, evicted: "no" | "yes", submit: boolean) => {
    const s = await A.startApplication(db, listingId, email);
    await A.saveApplicationStep(db, s.id, 1, { about });
    if (!submit) return s.id;
    await A.saveApplicationStep(db, s.id, 4, { residence: { currentAddress: "2210 N Halsted St, Chicago, IL", monthsAtAddress: "26", currentRent: "1650", landlordName: "Lakeview Rentals", landlordPhone: "(773) 555-0190", reasonForMoving: "Closer to work" }, employment: { employer: "Northwestern Medicine", title: "Nurse", monthsEmployed: "40", monthlyIncome: income }, more: { occupants: "2", pets: "One cat", vehicles: "2019 Honda Civic", reference: "Dana Kim (312) 555-0144", evicted } });
    await A.payApplicationFee(db, s.id, card);
    await A.submitApplication(db, s.id, { ip: "198.51.100.23" });
    return s.id;
  };
  await fill(live[0]!.id, "jordan.lee@example.com", { firstName: "Jordan", lastName: "Lee", phone: "(312) 555-0210", dob: "1993-04-12", ssnLast4: "4821", desiredMoveIn: toISODate(addDays(today, 21)) }, "7800", "no", true);
  await fill(live[1]!.id, "maya.patel@example.com", { firstName: "Maya", lastName: "Patel", phone: "(312) 555-0211", dob: "1998-09-30", ssnLast4: "0000", desiredMoveIn: toISODate(addDays(today, 30)) }, "3900", "no", true);
  const declined = await fill(live[2]!.id, "chris.novak@example.com", { firstName: "Chris", lastName: "Novak", phone: "(312) 555-0212", dob: "1988-01-15", ssnLast4: "6666", desiredMoveIn: toISODate(addDays(today, 14)) }, "3000", "yes", true);
  await A.declineApplication(db, declined, "Prior eviction record; income below 3× rent");
  await fill(live[3]!.id, "ana.silva@example.com", { firstName: "Ana", lastName: "Silva", phone: "(312) 555-0213" }, "", "no", false);

  // A renewal offer out for signature on the soonest-expiring residential lease with an email.
  const soon = await db.lease.findFirst({ where: { status: "ACTIVE", endDate: { gte: today, lte: addDays(today, 120) }, moveOutDate: null, tenants: { some: { tenant: { email: { not: null } } } }, property: { type: { in: ["MULTI_FAMILY", "SINGLE_FAMILY", "CONDO", "TOWNHOME"] } } }, orderBy: { endDate: "asc" }, include: { recurring: { where: { kind: "RENT" } } } });
  if (soon) {
    const rent = soon.recurring.reduce((s, r) => s + r.amountCents, 0);
    await sendRenewalOffer(db, { leaseId: soon.id, newRentCents: Math.round((rent * 1.03) / 500) * 500, termMonths: 12, message: "We'd love to have you stay another year!" }, { name: "Priya Manager", email: "pm@example.com" });
  }

  const counts = { listings: listings.length, published: live.length, prospects: prospects.length, applications: await db.application.count() };
  await app.$disconnect();
  return counts;
}
