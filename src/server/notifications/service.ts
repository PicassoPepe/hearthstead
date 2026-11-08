import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { can, type Module, type PermissionSet } from "@/server/permissions";

export type NotificationInput = { kind: string; title: string; body?: string | null; href?: string | null };

/**
 * In-app notifications (the bell). Sent to specific users, or to every active staff member whose
 * role can view a module (and, when given, whose property scope includes the property).
 * Never throws into the business action that raised it.
 */
export async function notifyUsers(db: ScopedDb, userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds.filter(Boolean))].filter((id) => id !== db.ctx.userId);
  if (!ids.length) return 0;
  try {
    await db.notification.createMany({ data: ids.map((userId) => ({ organizationId: db.ctx.orgId, userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, href: n.href ?? null })) });
    return ids.length;
  } catch (e) {
    console.error("[notifications] failed", e);
    return 0;
  }
}

export async function notifyModule(db: ScopedDb, module: Module, n: NotificationInput, propertyId?: string | null) {
  try {
    const members = await adminDb.membership.findMany({ where: { organizationId: db.ctx.orgId, status: "ACTIVE", deletedAt: null }, include: { role: true } });
    const ids = members
      .filter((m) => m.role.key !== "VENDOR" && can(m.role.permissions as PermissionSet, module, "view"))
      .filter((m) => !propertyId || !m.propertyScope.length || m.propertyScope.includes(propertyId))
      .map((m) => m.userId);
    return await notifyUsers(db, ids, n);
  } catch (e) {
    console.error("[notifications] failed", e);
    return 0;
  }
}

const money = (c: unknown) => `$${(Number(c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Domain events → notifications. Called from `emit`. */
export async function notifyForEvent(db: ScopedDb, type: string, d: Record<string, unknown>) {
  const pid = (d.propertyId as string | null) ?? null;
  if (type === "task.created" && d.type === "TENANT_REQUEST")
    await notifyModule(db, "tasks", { kind: "task", title: `${d.priority === "URGENT" ? "URGENT request" : "New tenant request"} #${d.number}`, body: String(d.title ?? ""), href: `/app/tasks/${d.taskId}` }, pid);
  else if (type === "payment.succeeded" && d.origin !== "MANUAL")
    await notifyModule(db, "accounting", { kind: "payment", title: `Payment received: ${money(d.amountCents)}`, body: d.method ? `Paid online by ${String(d.method).toLowerCase()}` : null, href: d.leaseId ? `/app/leasing/${d.leaseId}?tab=transactions` : null }, pid);
  else if (type === "payment.failed")
    await notifyModule(db, "accounting", { kind: "payment", title: `Payment failed: ${money(d.amountCents)}`, body: String(d.failureReason ?? ""), href: d.leaseId ? `/app/leasing/${d.leaseId}?tab=transactions` : null }, pid);
  else if (type === "application.submitted")
    await notifyModule(db, "leasing", { kind: "application", title: `New application #${d.number}`, body: `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim() || null, href: `/app/leasing/applications/${d.applicationId}` }, pid);
}

export async function listNotifications(db: ScopedDb, userId: string, take = 20) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}
