import type { ScopedDb } from "@/server/dal";
import type { PortalMsg } from "@/components/portal/portal-thread";

/** Messages a tenant/owner can see in their portal (internal notes excluded); marks staff messages read. */
export async function portalThread(db: ScopedDb, who: { tenantId?: string; ownerId?: string }, markRead: boolean): Promise<PortalMsg[]> {
  const conv = await db.conversation.findFirst({ where: who.tenantId ? { tenantId: who.tenantId } : { ownerId: who.ownerId }, orderBy: { lastMessageAt: "desc" } });
  if (!conv) return [];
  const msgs = await db.message.findMany({ where: { conversationId: conv.id, channel: { in: ["PORTAL", "SMS", "EMAIL"] } }, orderBy: { createdAt: "asc" }, take: 300 });
  if (markRead) await db.message.updateMany({ where: { conversationId: conv.id, direction: "OUT", readAt: null }, data: { readAt: new Date() } });
  return msgs.map((m) => ({ id: m.id, mine: m.direction === "IN", author: m.authorName, body: m.body, at: m.createdAt.toISOString(), channel: m.channel }));
}

export async function unreadPortalCount(db: ScopedDb, who: { tenantId?: string; ownerId?: string }) {
  return db.message.count({ where: { direction: "OUT", readAt: null, channel: { in: ["PORTAL", "SMS", "EMAIL"] }, conversation: who.tenantId ? { tenantId: who.tenantId } : { ownerId: who.ownerId } } });
}
