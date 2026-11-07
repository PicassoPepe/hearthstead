import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import * as C from "../src/server/comms/service";
import { saveAnnouncement } from "../src/server/comms/announcements";

/**
 * Phase 8 demo data: owner@example.com linked to owner Grace Harmon (owner portal), a few
 * conversations across portal and SMS, an owner thread, one sent and one scheduled announcement.
 */
export async function seedComms(adminUrl: string, appUrl: string, orgId: string, users: Record<string, string>) {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const staffId = users["pm@example.com"]!;
  const db = createScopedClient(app, { orgId, userId: staffId });
  const pm = { userId: staffId, name: "Priya Manager" };

  const grace = await db.owner.findFirstOrThrow({ where: { firstName: "Grace", lastName: "Harmon" } });
  await db.owner.update({ where: { id: grace.id }, data: { email: "owner@example.com", portalStatus: "ACTIVE" } });
  await db.ownerUser.create({ data: { organizationId: orgId, ownerId: grace.id, userId: users["owner@example.com"]!, acceptedAt: new Date(), createdById: staffId } });

  // Tenant conversations: the demo portal tenant plus two others.
  const portalTenant = await admin.tenantUser.findFirst({ where: { organizationId: orgId }, select: { tenantId: true } });
  const others = await db.tenant.findMany({ where: { phone: { not: null }, leases: { some: { lease: { status: "ACTIVE" } } }, ...(portalTenant ? { id: { not: portalTenant.tenantId } } : {}) }, take: 3, orderBy: { lastName: "asc" } });
  if (portalTenant) {
    const t = await db.tenant.findFirstOrThrow({ where: { id: portalTenant.tenantId } });
    const who = { userId: users["tenant@example.com"] ?? null, name: `${t.firstName} ${t.lastName}` };
    await C.receivePortalMessage(db, { tenantId: t.id }, "Hi! Is it OK if I install a wall-mounted TV in the living room?", who);
    const conv = await db.conversation.findFirstOrThrow({ where: { tenantId: t.id } });
    await C.sendMessage(db, conv.id, { body: "Hi — yes, that's fine. Please use the studs and patch any holes when you move out. Thanks for asking!", channel: "PORTAL", author: pm });
    await C.receivePortalMessage(db, { tenantId: t.id }, "Great, thank you. Also, the hallway light outside my door is flickering.", who);
  }
  if (others[0]) {
    await C.startConversation(db, { tenantId: others[0].id }, { body: "Hi, this is Priya from Maple & Main. A plumber will be in the building Thursday 9–11am to service the water heater. No action needed!", channel: "SMS", author: pm });
    await C.receiveInboundSms({ from: others[0].phone!, body: "Thanks for the heads up 👍", externalId: `SMseed1-${Date.now()}`, orgId });
  }
  if (others[1]) {
    await C.receiveInboundSms({ from: others[1].phone!, body: "Hey my rent payment might be 2 days late this month, is that ok?", externalId: `SMseed2-${Date.now()}`, orgId });
  }
  await C.startConversation(db, { ownerId: grace.id }, { body: "Hi Grace — October statements are posted in your portal. 35 Aspen Court is fully rented through next summer.", channel: "PORTAL", author: pm });
  await C.receivePortalMessage(db, { ownerId: grace.id }, "Thanks Priya! Could you get a quote for new gutters at Cedar Duplex?", { userId: users["owner@example.com"]!, name: "Grace Harmon" });

  await saveAnnouncement(db, null, { title: "Fall gutter cleaning", body: "Crews will clean gutters at every building next week. Please move cars from the side lots on your building's day — we'll post the schedule in the lobby.", audience: { type: "ALL_TENANTS", propertyIds: [] }, channels: ["PORTAL", "EMAIL"] }, "send");
  await saveAnnouncement(db, null, { title: "Q4 owner update", body: "Year-end statements and 1099s will be posted in your portal by January 31.", audience: { type: "ALL_OWNERS", propertyIds: [] }, channels: ["PORTAL", "EMAIL"], scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString() }, "schedule");

  const counts = { conversations: await db.conversation.count(), announcements: await db.announcement.count() };
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
  return counts;
}
