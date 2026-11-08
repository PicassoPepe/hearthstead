"use server";

import { getContext } from "@/server/context";
import { listNotifications } from "@/server/notifications/service";

export type NotificationView = { id: string; kind: string; title: string; body: string | null; href: string | null; read: boolean; createdAt: string };

/** The signed-in user's latest notifications (bell). Returns empty when signed out. */
export async function loadNotifications(): Promise<{ items: NotificationView[]; unread: number }> {
  const ctx = await getContext();
  if (!ctx) return { items: [], unread: 0 };
  const r = await listNotifications(ctx.db, ctx.user.id, 20);
  return {
    unread: r.unread,
    items: r.items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() })),
  };
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const ctx = await getContext();
  if (!ctx) return;
  await ctx.db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
}
