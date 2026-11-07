import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import { setSetting } from "@/server/settings/service";
import * as C from "@/server/comms/service";
import * as A from "@/server/comms/announcements";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let db: ScopedDb;
let tenantId: string;
let ownerId: string;
let propertyId: string;
const me = () => ({ userId: O.userId, name: "Sam Staff" });
const phone = `+1312555${String(Math.floor(1000 + Math.random() * 8999))}`;

beforeAll(async () => {
  O = await makeOrg("CM");
  B = await makeOrg("CB");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  ownerId = (await db.owner.create({ data: { organizationId: O.orgId, firstName: "Olga", lastName: "Owner", email: `olga-${Date.now()}@example.com`, phone: "(773) 555-0199" } })).id;
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Comms Court", address: { addressLine1: "1 C St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 1 }], owners: [{ ownerId, percentBps: 10_000 }] })).id;
  const unit = (await db.unit.findFirstOrThrow({ where: { propertyId } })).id;
  const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const lease = await createLease(db, { propertyId, unitIds: [unit], termType: "FIXED", startDate: "2026-11-01", endDate: "2027-10-31", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Tia", lastName: "Text", email: `tia-${Date.now()}@example.com`, phone }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 100_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-11-01"));
  tenantId = (await db.leaseTenant.findFirstOrThrow({ where: { leaseId: lease.id } })).tenantId;
});
afterAll(async () => {
  await cleanup([O.orgId, B.orgId], [O.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("inbox", () => {
  it("portal message in, staff SMS reply out (metered), inbound SMS threads into the same conversation", async () => {
    await C.receivePortalMessage(db, { tenantId }, "My sink is leaking under the cabinet", { userId: null, name: "Tia Text" });
    const conv = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    expect(conv.unreadCount).toBe(1);
    const draft = await C.draftReply(db, conv.id, "Sam Staff");
    expect(draft).toMatch(/maintenance team/);
    await C.sendMessage(db, conv.id, { body: draft, channel: "SMS", author: me(), aiDrafted: true });
    expect((await C.smsUsage(db)).used).toBeGreaterThan(0);
    const r = await C.receiveInboundSms({ from: phone, body: "Thanks!", externalId: `SMin-${Date.now()}` });
    expect(r).toMatchObject({ handled: true, conversationId: conv.id });
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(3);
  });

  it("STOP opts out; texts are then refused; START opts back in", async () => {
    await C.receiveInboundSms({ from: phone, body: "STOP", externalId: `SMstop-${Date.now()}`, orgId: O.orgId });
    const conv = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await expect(C.sendMessage(db, conv.id, { body: "Hello", channel: "SMS", author: me() })).rejects.toThrow(/opted out/);
    await C.receiveInboundSms({ from: phone, body: "start", externalId: `SMstart-${Date.now()}`, orgId: O.orgId });
    await expect(C.sendMessage(db, conv.id, { body: "Welcome back", channel: "SMS", author: me() })).resolves.toBeTruthy();
  });

  it("enforces the monthly SMS limit and the on/off switch", async () => {
    const conv = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await setSetting(db, "communications.smsMonthlyLimit", "ORG", O.orgId, 1);
    await expect(C.sendMessage(db, conv.id, { body: "x", channel: "SMS", author: me() })).rejects.toThrow(/limit reached/);
    await setSetting(db, "communications.smsMonthlyLimit", "ORG", O.orgId, 1000);
    await setSetting(db, "communications.smsEnabled", "ORG", O.orgId, false);
    await expect(C.sendMessage(db, conv.id, { body: "x", channel: "SMS", author: me() })).rejects.toThrow(/turned off/);
    await setSetting(db, "communications.smsEnabled", "ORG", O.orgId, true);
  });

  it("another org can't post into this org's conversation", async () => {
    const dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
    const conv = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await expect(C.sendMessage(dbB, conv.id, { body: "hi", channel: "NOTE", author: { userId: B.userId, name: "B" } })).rejects.toThrow(/not found/);
    await expect(C.findOrCreateConversation(dbB, { tenantId })).rejects.toThrow(/not found/);
  });
});

describe("announcements", () => {
  it("resolves audiences, delivers per channel once, and shows in the portal", async () => {
    const tenants = await A.resolveAudience(db, { type: "PROPERTY_TENANTS", propertyIds: [propertyId] });
    expect(tenants.map((t) => t.tenantId)).toEqual([tenantId]);
    const owners = await A.resolveAudience(db, { type: "ALL_OWNERS", propertyIds: [] });
    expect(owners.map((o) => o.ownerId)).toContain(ownerId);
    const r = await A.saveAnnouncement(db, null, { title: "Water shutoff Tuesday", body: "Water will be off 9–11am for a riser repair.", audience: { type: "PROPERTY_TENANTS", propertyIds: [propertyId] }, channels: ["PORTAL", "EMAIL", "SMS"] }, "send");
    expect(r).toMatchObject({ sent: 3, failed: 0 });
    expect((await A.sendAnnouncement(db, r.id)).sent).toBe(0); // idempotent
    expect((await A.portalAnnouncements(db, { tenantId }))[0]?.title).toBe("Water shutoff Tuesday");
  });

  it("schedules and sends when due", async () => {
    const r = await A.saveAnnouncement(db, null, { title: "Owner update", body: "Quarterly statements are ready.", audience: { type: "ALL_OWNERS", propertyIds: [] }, channels: ["PORTAL"], scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, "schedule");
    expect(await A.sendDueAnnouncements(db, new Date())).toBe(0);
    expect(await A.sendDueAnnouncements(db, new Date(Date.now() + 7_200_000))).toBe(1);
    expect((await db.announcement.findFirstOrThrow({ where: { id: r.id } })).status).toBe("SENT");
    await expect(A.saveAnnouncement(db, null, { title: "Bad", body: "Past time test.", audience: { type: "ALL_OWNERS", propertyIds: [] }, channels: ["PORTAL"], scheduledFor: "2020-01-01T00:00:00Z" }, "schedule")).rejects.toThrow(/future/);
  });
});
