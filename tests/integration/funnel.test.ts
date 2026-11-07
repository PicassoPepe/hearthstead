import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import * as L from "@/server/funnel/listings";
import * as A from "@/server/funnel/applications";
import * as E from "@/server/funnel/esign";
import * as R from "@/server/funnel/renewals";
import { renderTemplate } from "@/lib/templates";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let db: ScopedDb;
let propertyId: string;
let units: string[];
let listingId: string;
const meta = { ip: "203.0.113.7", ua: "vitest" };

beforeAll(async () => {
  O = await makeOrg("FN");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Funnel Flats", address: { addressLine1: "9 Funnel Rd", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "A", marketRentCents: 180_000 }, { name: "B", marketRentCents: 150_000 }], owners: [] })).id;
  units = (await db.unit.findMany({ where: { propertyId }, orderBy: { name: "asc" } })).map((u) => u.id);
  await db.processorAccount.create({ data: { organizationId: O.orgId, provider: "mock", externalId: "acct_mock", status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true } });
});
afterAll(async () => {
  await cleanup([O.orgId], [O.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("listings", () => {
  it("AI description, publish rules, unique slug, auto-delist once leased", async () => {
    const desc = await L.describeListing(db, units[0]!, 180_000, "Cats OK");
    expect(desc).toMatch(/unit A at Funnel Flats/);
    const l = await L.saveListing(db, null, { unitId: units[0]!, title: "Sunny 2BR at Funnel Flats", description: "", rentCents: 180_000, depositCents: 180_000, leaseTermMonths: 12, petPolicy: "Cats OK", syndicate: true });
    listingId = l.id;
    expect(l.slug).toBe("funnel-flats-a");
    await expect(L.setListingStatus(db, l.id, "PUBLISHED")).rejects.toThrow(/description/);
    await L.saveListing(db, l.id, { unitId: units[0]!, title: l.title, description: desc, rentCents: 180_000, depositCents: 180_000, leaseTermMonths: 12, petPolicy: "Cats OK", syndicate: true });
    await L.setListingStatus(db, l.id, "PUBLISHED");
    expect((await db.unit.findFirstOrThrow({ where: { id: units[0]! } })).isListed).toBe(true);
    await expect(L.saveListing(db, null, { unitId: units[0]!, title: "Dup listing", description: "", rentCents: 1, depositCents: 0, leaseTermMonths: 12, petPolicy: "", syndicate: false })).rejects.toThrow(/already has a listing/);
  });

  it("showings can't double-book", async () => {
    const p = await L.createProspect(db, { firstName: "Pat", lastName: "Prospect", email: "pat@example.com" });
    const at = new Date(Date.now() + 86_400_000).toISOString();
    await L.scheduleShowing(db, { listingId, prospectId: p.id, startsAt: at });
    await expect(L.scheduleShowing(db, { listingId, prospectId: p.id, startsAt: new Date(Date.parse(at) + 10 * 60_000).toISOString() })).rejects.toThrow(/overlaps/);
    const s = await db.showing.findFirstOrThrow({ where: { listingId } });
    await L.setShowingStatus(db, s.id, "COMPLETED");
    expect((await db.prospect.findFirstOrThrow({ where: { id: p.id } })).status).toBe("TOURED");
  });
});

describe("applications", () => {
  let appId: string;
  it("start → autosave → step validation → fee (ledger) → submit → screening", async () => {
    const s = await A.startApplication(db, listingId, "Jordan.Lee@Example.com");
    appId = s.id;
    expect(await A.applicationByToken(db, s.token)).toMatchObject({ id: s.id, email: "jordan.lee@example.com" });
    expect((await A.startApplication(db, listingId, "jordan.lee@example.com")).resumed).toBe(true);
    const d0 = await A.saveApplicationStep(db, appId, 1, { about: { firstName: "Jordan", lastName: "Lee", phone: "312-555-0177", dob: "1994-03-02", ssnLast4: "1234", desiredMoveIn: "2026-12-01" } });
    expect(A.stepErrors(0, d0)).toEqual({});
    expect(Object.keys(A.stepErrors(2, d0))).toContain("employment.monthlyIncome");
    await A.saveApplicationStep(db, appId, 2, { residence: { currentAddress: "1 Old St", monthsAtAddress: "24" } });
    await A.saveApplicationStep(db, appId, 3, { employment: { employer: "Acme", monthlyIncome: "7000" } });
    await expect(A.submitApplication(db, appId, { ip: null })).rejects.toThrow(/A few more questions/);
    await A.saveApplicationStep(db, appId, 4, { more: { evicted: "no" } });
    await expect(A.submitApplication(db, appId, { ip: null })).rejects.toThrow(/fee/);
    await expect(A.payApplicationFee(db, appId, { number: "4000000000000002", expMonth: 1, expYear: 2031, cvc: "123" })).rejects.toThrow();
    const paid = await A.payApplicationFee(db, appId, { number: "4242424242424242", expMonth: 1, expYear: 2031, cvc: "123" });
    expect(paid.feePaidAt).not.toBeNull();
    const line = await db.journalLine.findFirst({ where: { journalEntryId: paid.feeJournalEntryId!, account: { systemKey: "APPLICATION_FEE_INCOME" } } });
    expect(line).toMatchObject({ creditCents: paid.feeCents, propertyId });
    const r = await A.submitApplication(db, appId, { ip: "203.0.113.7" });
    expect(r.incomeToRent).toBeCloseTo(3.89, 2);
    expect((await db.application.findFirstOrThrow({ where: { id: appId } })).status).toBe("SUBMITTED");
    expect((await db.prospect.findFirstOrThrow({ where: { email: "jordan.lee@example.com" } })).status).toBe("APPLIED");
  });

  it("decline sends an adverse action notice; approve gives a lease preset", async () => {
    const s = await A.startApplication(db, listingId, "evicted@example.com");
    await A.saveApplicationStep(db, s.id, 4, { about: { firstName: "Eve", lastName: "Vic", phone: "3125550100", dob: "1990-01-01", ssnLast4: "6666" }, residence: { currentAddress: "x", monthsAtAddress: "1" }, employment: { employer: "y", monthlyIncome: "2000" }, more: { evicted: "yes" } });
    await A.payApplicationFee(db, s.id, { number: "4242424242424242", expMonth: 1, expYear: 2031, cvc: "123" });
    const res = await A.submitApplication(db, s.id, { ip: null });
    expect(res.recommendation).toBe("DECLINE");
    await A.declineApplication(db, s.id, "Prior eviction; income below 3× rent");
    const mail = await admin.emailMessage.findFirst({ where: { to: "evicted@example.com", subject: { contains: "adverse action" } } });
    expect(mail?.html).toMatch(/Fair Credit Reporting Act/);
    expect(mail?.html).toMatch(/Prior eviction/);
    await A.approveApplication(db, appId);
    const preset = await A.leasePresetFromApplication(db, appId);
    expect(preset).toMatchObject({ propertyId, unitId: units[0], rentCents: 180_000, startDate: "2026-12-01", tenant: { firstName: "Jordan", email: "jordan.lee@example.com" } });
  });
});

describe("templates & e-sign", () => {
  it("merge fields are escaped and missing ones flagged", () => {
    const r = renderTemplate("# Hi {{tenant.names}}\n\n**Rent** {{lease.rent}} {{nope}}", { "tenant.names": "<script>x</script>", "lease.rent": "$1.00" });
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("<strong>Rent</strong>");
    expect(r.missing).toEqual(["nope"]);
  });

  it("lease → tenants sign → manager countersigns → signed copy + certificate stored on the lease", async () => {
    const lease = await createLease(db, { propertyId, unitIds: [units[1]!], termType: "FIXED", startDate: "2026-01-01", endDate: "2026-12-31", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Sam", lastName: "Signer", email: `sam-${Date.now()}@example.com` }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id, description: "Rent", amountCents: 150_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-01-01"));
    const sent = await E.sendLeaseForSignature(db, lease.id, null, { name: "Mia Manager", email: "mia@example.com" });
    expect(sent.links).toHaveLength(2);
    const tenantToken = sent.links[0]!.url.split("/sign/")[1]!;
    const managerToken = sent.links[1]!.url.split("/sign/")[1]!;
    await expect(E.signDocument(managerToken, "Mia Manager", meta)).rejects.toThrow(/other signers|invalid/);
    await E.recordView(tenantToken, meta);
    await expect(E.signDocument(tenantToken, "Somebody Else", meta)).rejects.toThrow(/exactly/);
    expect((await E.signDocument(tenantToken, "sam  signer", meta)).completed).toBe(false);
    // The manager gets a fresh link by email after tenants sign; read it from the outbox.
    const mail = await admin.emailMessage.findFirst({ where: { to: "mia@example.com", subject: { startsWith: "Please sign" } }, orderBy: { createdAt: "desc" } });
    const fresh = mail!.html.match(/\/sign\/([A-Za-z0-9_-]+)/)![1]!;
    expect((await E.signDocument(fresh, "Mia Manager", meta)).completed).toBe(true);
    const req = await db.signatureRequest.findFirstOrThrow({ where: { id: sent.id }, include: { events: true } });
    expect(req.status).toBe("COMPLETED");
    expect(req.events.map((e) => e.event)).toEqual(expect.arrayContaining(["SENT", "VIEWED", "SIGNED", "COMPLETED"]));
    const att = await db.attachment.findFirstOrThrow({ where: { id: req.finalAttachmentId! } });
    expect(att).toMatchObject({ entityType: "Lease", entityId: lease.id });
  });

  it("renewal offer → tenant signs → renewal lease created with the new rent", async () => {
    const lease = await db.lease.findFirstOrThrow({ where: { units: { some: { unitId: units[1]! } }, status: "ACTIVE" }, include: { tenants: { include: { tenant: true } } } });
    const cands = await R.renewalCandidates(db, d("2026-11-01"));
    expect(cands.find((c) => c.leaseId === lease.id)?.suggestedCents).toBe(154_500);
    const sent = await R.sendRenewalOffer(db, { leaseId: lease.id, newRentCents: 155_000, termMonths: 12 }, { name: "Mia Manager", email: "mia@example.com" });
    await expect(R.sendRenewalOffer(db, { leaseId: lease.id, newRentCents: 155_000, termMonths: 12 }, { name: "Mia Manager", email: "mia@example.com" })).rejects.toThrow(/already out/);
    await E.signDocument(sent.links[0]!.url.split("/sign/")[1]!, lease.tenants[0]!.tenant.firstName + " " + lease.tenants[0]!.tenant.lastName, meta);
    const mail = await admin.emailMessage.findFirst({ where: { to: "mia@example.com", subject: { contains: "renewal" } }, orderBy: { createdAt: "desc" } });
    await E.signDocument(mail!.html.match(/\/sign\/([A-Za-z0-9_-]+)/)![1]!, "Mia Manager", meta);
    const offer = await db.renewalOffer.findFirstOrThrow({ where: { id: sent.offerId } });
    expect(offer.status).toBe("ACCEPTED");
    const next = await db.lease.findFirstOrThrow({ where: { id: offer.newLeaseId! }, include: { recurring: true } });
    expect(next.startDate.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(next.recurring.find((r) => r.kind === "RENT")?.amountCents).toBe(155_000);
    expect((await db.lease.findFirstOrThrow({ where: { id: lease.id } })).moveOutDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("auto-delists a listing when its unit is leased", async () => {
    await createLease(db, { propertyId, unitIds: [units[0]!], termType: "FIXED", startDate: "2026-11-01", endDate: "2027-10-31", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Jordan", lastName: "Lee" }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id, description: "Rent", amountCents: 180_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-11-01"));
    expect(await L.autoDelist(db)).toBe(1);
    expect((await db.listing.findFirstOrThrow({ where: { id: listingId } })).status).toBe("UNLISTED");
  });
});
