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
    await createTask(db, { title: "Self-made request", type: "TENANT_REQUEST", propertyId, tenantId }, { userId: O.userId, name: "User", kind: "USER" });
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
