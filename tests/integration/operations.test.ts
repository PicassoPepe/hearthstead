import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import { createTask } from "@/server/maintenance/tasks";
import { sendRentReminders } from "@/server/leasing/reminders";
import { emailOwnerStatements } from "@/server/accounting/owner-statements";
import { listNotifications } from "@/server/notifications/service";
import { receivePortalMessage } from "@/server/comms/service";
import { addPhotos, setPhotos } from "@/server/images/service";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let db: ScopedDb;
let sys: ScopedDb;
let propertyId: string;
let leaseId: string;
let tenantId: string;
let ownerId: string;

beforeAll(async () => {
  O = await makeOrg("OPS");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  sys = createScopedClient(app, { orgId: O.orgId, userId: null });
  ownerId = (await db.owner.create({ data: { organizationId: O.orgId, firstName: "Olive", lastName: "Owner", email: `olive-${O.orgId}@test.local` } })).id;
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Ops Court", address: { addressLine1: "5 Ops Rd", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "A", marketRentCents: 150_000 }, { name: "B", marketRentCents: 150_000 }], owners: [{ ownerId, percentBps: 10_000 }] })).id;
  const unit = (await db.unit.findFirstOrThrow({ where: { propertyId, name: "A" } })).id;
  const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  leaseId = (await createLease(db, { propertyId, unitIds: [unit], termType: "FIXED", startDate: "2026-10-01", endDate: "2027-09-30", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Remy", lastName: "Renter", email: `remy-${O.orgId}@test.local` }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 150_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-11-07"))).id;
  tenantId = (await db.leaseTenant.findFirstOrThrow({ where: { leaseId } })).tenantId;
});
afterAll(async () => {
  await cleanup([O.orgId], [O.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

const emailsTo = (to: string) => admin.emailMessage.findMany({ where: { organizationId: O.orgId, to }, orderBy: { createdAt: "asc" } });

describe("rent reminders", () => {
  it("sends a past-due reminder 2 days after the due date only while there's a balance, once", async () => {
    const remy = `remy-${O.orgId}@test.local`;
    expect(await sendRentReminders(db, d("2026-11-03"))).toBe(1);
    const mail = await emailsTo(remy);
    expect(mail.at(-1)!.text).toMatch(/balance of \$3,000\.00 for Ops Court · A/);
    expect(await sendRentReminders(db, d("2026-11-03"))).toBe(0); // idempotent
    // Logged on the tenant's communication history.
    expect(await db.message.count({ where: { conversation: { tenantId }, channel: "EMAIL" } })).toBe(1);
  });
  it("sends a before-due reminder 3 days ahead (default) for next month", async () => {
    expect(await sendRentReminders(db, d("2026-11-28"))).toBe(1);
    expect((await emailsTo(`remy-${O.orgId}@test.local`)).at(-1)!.text).toMatch(/rent of \$1,500\.00 for Ops Court · A is due Dec 1, 2026/);
    expect(await sendRentReminders(db, d("2026-11-15"))).toBe(0); // nothing due that day
  });
});

describe("notifications", () => {
  it("tenant requests and portal messages notify staff (not the person who acted)", async () => {
    await createTask(sys, { title: "Water heater out", type: "TENANT_REQUEST", priority: "URGENT", propertyId, tenantId }, { userId: null, name: "Remy Renter", kind: "TENANT" });
    await receivePortalMessage(sys, { tenantId }, "Is the plumber coming today?", { userId: null, name: "Remy Renter" });
    const n = await listNotifications(db, O.userId);
    expect(n.unread).toBeGreaterThanOrEqual(2);
    expect(n.items.map((i) => i.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^URGENT request #\d+/), "New message from Remy Renter"]));
    // An action by the user themselves doesn't notify them.
    const before = n.items.length;
    await createTask(db, { title: "Self-made request", type: "TENANT_REQUEST", propertyId, tenantId }, { userId: O.userId, name: "User", kind: "STAFF" });
    expect((await listNotifications(db, O.userId)).items.length).toBe(before);
  });
});

describe("owner statements", () => {
  it("emails last month's statement on the 1st, once per owner per month", async () => {
    expect(await emailOwnerStatements(db, d("2026-12-02"))).toBe(0); // not the 1st
    expect(await emailOwnerStatements(db, d("2026-12-01"))).toBe(1);
    expect(await emailOwnerStatements(db, d("2026-12-01"))).toBe(0);
    const m = (await emailsTo(`olive-${O.orgId}@test.local`)).at(-1)!;
    expect(m.subject).toMatch(/November 2026 owner statement/);
    expect(m.html).toContain("Ops Court — 100% ownership");
  });
});

describe("photos", () => {
  it("adds, reorders and removes property photos; the first is the cover", async () => {
    const png = (n: number) => new File([new Uint8Array([137, 80, 78, 71, n])], `p${n}.png`, { type: "image/png" });
    const ids = await addPhotos(db, { kind: "property", id: propertyId }, [png(1), png(2)]);
    let p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
    expect(p.photos).toEqual(ids);
    expect(p.photoUrl).toBe(`/api/images/${ids[0]}`);
    await setPhotos(db, { kind: "property", id: propertyId }, [ids[1]!]);
    p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
    expect(p.photoUrl).toBe(`/api/images/${ids[1]}`);
    expect(await db.attachment.findFirst({ where: { id: ids[0] } })).toBeNull(); // soft-deleted (hidden by the DAL)
    await expect(addPhotos(db, { kind: "property", id: propertyId }, [new File(["x"], "a.txt", { type: "text/plain" })])).rejects.toThrow(/JPG, PNG/);
    await expect(setPhotos(db, { kind: "property", id: propertyId }, ["not-mine"])).rejects.toThrow();
  });
});

describe("recurring charges & rent increases", () => {
  it("changes take effect only from the next unposted month and bill exactly", async () => {
    const R = await import("@/server/leasing/recurring");
    const { runRecurringForLease } = await import("@/server/leasing/leases");
    const rc = await db.recurringCharge.findFirstOrThrow({ where: { leaseId, kind: "RENT" } });
    await expect(R.changeRecurringCharge(db, rc.id, { amountCents: 160_000, effectiveDate: "2026-11-15" })).rejects.toThrow(/already posted/);
    await R.changeRecurringCharge(db, rc.id, { amountCents: 160_000, effectiveDate: "2026-12-01" });
    await db.tx((tx) => runRecurringForLease(tx, { orgId: O.orgId, userId: null }, leaseId, d("2026-12-05")));
    const dec = await db.leaseTransaction.findMany({ where: { leaseId, type: "CHARGE", date: { gte: d("2026-12-01"), lte: d("2026-12-31") } } });
    expect(dec.map((t) => t.amountCents)).toEqual([160_000]);

    const preview = await R.previewIncrease(db, { leaseIds: [leaseId], mode: "PERCENT", value: 3, effectiveDate: "2027-01-01" });
    expect(preview[0]).toMatchObject({ currentCents: 160_000, newCents: 164_800, error: null });
    expect((await R.previewIncrease(db, { leaseIds: [leaseId], mode: "PERCENT", value: 3, effectiveDate: "2026-12-01" }))[0]!.error).toMatch(/already posted/);
    const r = await R.applyIncrease(db, { leaseIds: [leaseId], mode: "PERCENT", value: 3, effectiveDate: "2027-01-01", notify: true });
    expect(r).toMatchObject({ updated: 1, notified: 1 });
    await db.tx((tx) => runRecurringForLease(tx, { orgId: O.orgId, userId: null }, leaseId, d("2027-01-03")));
    const jan = await db.leaseTransaction.findMany({ where: { leaseId, type: "CHARGE", date: { gte: d("2027-01-01"), lte: d("2027-01-31") } } });
    expect(jan.map((t) => t.amountCents)).toEqual([164_800]);
  });
  it("adds a parking charge mid-month (prorated) and ends it", async () => {
    const R = await import("@/server/leasing/recurring");
    const { runRecurringForLease } = await import("@/server/leasing/leases");
    const acct = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    const p = await R.addRecurringCharge(db, leaseId, { kind: "OTHER", accountId: acct, description: "Parking P7", amountCents: 6_200, startDate: "2027-01-17" });
    await db.tx((tx) => runRecurringForLease(tx, { orgId: O.orgId, userId: null }, leaseId, d("2027-02-02")));
    const parking = await db.leaseTransaction.findMany({ where: { leaseId, memo: { startsWith: "Parking P7" } }, orderBy: { date: "asc" } });
    expect(parking.map((t) => t.amountCents)).toEqual([3_000, 6_200]); // 15/31 days of $62, then February
    await expect(R.endRecurringCharge(db, p.id, "2027-01-31")).rejects.toThrow(/Already billed/);
    await R.endRecurringCharge(db, p.id, "2027-03-31");
    expect((await db.recurringCharge.findFirstOrThrow({ where: { id: p.id } })).endDate?.toISOString().slice(0, 10)).toBe("2027-03-31");
  });
});

describe("keys & spaces", () => {
  it("assigning a paid parking space bills the lease; returning it stops billing", async () => {
    const K = await import("@/server/rentals/keys");
    const { id } = await K.saveKeyItem(db, null, { kind: "PARKING", label: "P1", propertyId, monthlyFeeCents: 5_000 });
    await expect(K.saveKeyItem(db, null, { kind: "PARKING", label: "P1", propertyId })).rejects.toThrow(/already used/);
    await K.assignKeyItem(db, id, { leaseId, date: "2027-04-01", billFee: true });
    let k = await db.keyItem.findFirstOrThrow({ where: { id } });
    expect(k).toMatchObject({ status: "ASSIGNED", leaseId, holderName: "Remy Renter" });
    const rc = await db.recurringCharge.findFirstOrThrow({ where: { id: k.recurringChargeId! } });
    expect(rc).toMatchObject({ description: "Parking P1", amountCents: 5_000 });
    await expect(K.assignKeyItem(db, id, { leaseId, date: "2027-04-01", billFee: true })).rejects.toThrow(/Already assigned/);
    await K.returnKeyItem(db, id, { date: "2027-05-15" });
    k = await db.keyItem.findFirstOrThrow({ where: { id } });
    expect(k).toMatchObject({ status: "AVAILABLE", leaseId: null });
    expect((await db.recurringCharge.findFirstOrThrow({ where: { id: rc.id } })).endDate?.toISOString().slice(0, 10)).toBe("2027-05-15");
  });
});

describe("land records", () => {
  it("stores the county record, flags owner mismatches, records errors, and refreshes when stale", async () => {
    const LR = await import("@/server/rentals/land-records");
    const { mockLookup } = await import("@/adapters/parcels");
    let rec = await LR.refreshLandRecord(db, propertyId, async (q) => mockLookup(q));
    expect(rec).toMatchObject({ status: "LOOKED_UP", source: "mock", ownerName: "OLIVE OWNER" });
    let v = await LR.landRecordView(db, propertyId, (id) => `/f/${id}`);
    expect(v.match).toBe(true); // Olive Owner is the owner on file
    await LR.refreshLandRecord(db, propertyId, async (q) => ({ ...mockLookup(q), ownerName: "NEW BUYER LLC" }));
    v = await LR.landRecordView(db, propertyId, (id) => `/f/${id}`);
    expect(v.match).toBe(false);
    // Service errors are kept on the record and surfaced as a friendly message.
    await expect(LR.refreshLandRecord(db, propertyId, async () => { throw new Error("county map is down"); })).rejects.toThrow(/county map is down/);
    rec = (await db.parcelRecord.findFirstOrThrow({ where: { propertyId } }));
    expect(rec).toMatchObject({ status: "ERROR", error: "county map is down", ownerName: "NEW BUYER LLC" }); // last good data kept
    // Deed documents appear in the view (and therefore the owner portal).
    const { storeAttachment } = await import("@/server/records/service");
    await storeAttachment(db, { name: "deed.pdf", type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) }, { type: "Property", id: propertyId }, "Deed");
    v = await LR.landRecordView(db, propertyId, (id) => `/f/${id}`);
    expect(v.docs).toEqual([expect.objectContaining({ name: "deed.pdf", category: "Deed" })]);
    // Nightly refresh only touches records older than 90 days.
    process.env.PARCELS_PROVIDER = "mock";
    expect(await LR.refreshStaleLandRecords(db, new Date())).toBe(0);
    expect(await LR.refreshStaleLandRecords(db, new Date(Date.now() + 91 * 86_400_000))).toBe(1);
    expect((await db.parcelRecord.findFirstOrThrow({ where: { propertyId } })).status).toBe("LOOKED_UP");
    delete process.env.PARCELS_PROVIDER;
  });
});

describe("land records entered by hand", () => {
  it("are kept when an automatic lookup finds nothing (e.g. counties without public data)", async () => {
    const LR = await import("@/server/rentals/land-records");
    await LR.saveManualLandRecord(db, propertyId, { parcelId: "072-00-00-012.00", ownerName: "Olive Owner", acres: 0.42, deedBook: "312", deedPage: "88", assessedValueCents: 9_800_000 });
    await expect(LR.saveManualLandRecord(db, propertyId, { lastSaleDate: "May 2020" })).rejects.toThrow(/full date/);
    await LR.refreshLandRecord(db, propertyId, async () => ({ ...(await import("@/adapters/parcels")).mockLookup({ addressLine1: "x", city: "Monticello", state: "KY", postalCode: "42633" }), status: "NOT_FOUND", parcelId: null, ownerName: null, latitude: 36.83, longitude: -84.85 }));
    const rec = await db.parcelRecord.findFirstOrThrow({ where: { propertyId } });
    expect(rec).toMatchObject({ source: "manual", parcelId: "072-00-00-012.00", ownerName: "OLIVE OWNER", deedBook: "312", latitude: 36.83 });
    expect((await LR.landRecordView(db, propertyId, (id) => id)).match).toBe(true);
  });
});
