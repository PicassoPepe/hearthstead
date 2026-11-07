import "server-only";
import type { Prisma } from "@prisma/client";
import type { AppContext } from "@/server/context";
import { adminDb } from "@/server/db";
import { taskVisibility } from "./tasks";
import { tenantDisplayName } from "@/lib/leasing";
import { orgToday } from "@/server/leasing/queries";
import { toISODate } from "@/lib/dates";

export type TaskRow = {
  id: string;
  number: number;
  type: string;
  status: string;
  priority: string;
  title: string;
  category: string | null;
  where: string;
  propertyId: string | null;
  vendor: string;
  assignees: string;
  assigneeIds: string[];
  dueDate: string | null;
  overdue: boolean;
  createdAt: string;
  subtasks: number;
};

async function names(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const users = await adminDb.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

export async function listTasks(ctx: AppContext, extra: Prisma.TaskWhereInput = {}): Promise<TaskRow[]> {
  const vis = await taskVisibility(ctx.db, { userId: ctx.user.id, roleKey: ctx.membership.roleKey, propertyScope: ctx.membership.propertyScope });
  const tasks = await ctx.db.task.findMany({
    where: { AND: [vis, extra, { parentTaskId: null }] },
    include: { vendor: { select: { name: true } }, assignees: true, _count: { select: { subtasks: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 1000,
  });
  const [props, units, who, today] = await Promise.all([
    ctx.db.property.findMany({ where: { id: { in: tasks.map((t) => t.propertyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ctx.db.unit.findMany({ where: { id: { in: tasks.map((t) => t.unitId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    names(tasks.flatMap((t) => t.assignees.map((a) => a.userId))),
    orgToday(ctx),
  ]);
  const pm = new Map(props.map((p) => [p.id, p.name]));
  const um = new Map(units.map((u) => [u.id, u.name]));
  return tasks.map((t) => ({
    id: t.id,
    number: t.number,
    type: t.type,
    status: t.status,
    priority: t.priority,
    title: t.title,
    category: t.category,
    where: t.propertyId ? `${pm.get(t.propertyId) ?? ""}${t.unitId && um.get(t.unitId) !== "Main" ? ` · ${um.get(t.unitId) ?? ""}` : ""}` : "—",
    propertyId: t.propertyId,
    vendor: t.vendor?.name ?? "",
    assignees: t.assignees.map((a) => who.get(a.userId) ?? "").filter(Boolean).join(", "),
    assigneeIds: t.assignees.map((a) => a.userId),
    dueDate: t.dueDate ? toISODate(t.dueDate) : null,
    overdue: Boolean(t.dueDate && t.dueDate < today && !["COMPLETED", "ARCHIVED"].includes(t.status)),
    createdAt: t.createdAt.toISOString(),
    subtasks: t._count.subtasks,
  }));
}

export async function taskDetail(ctx: AppContext, taskId: string) {
  const vis = await taskVisibility(ctx.db, { userId: ctx.user.id, roleKey: ctx.membership.roleKey, propertyScope: ctx.membership.propertyScope });
  const t = await ctx.db.task.findFirst({
    where: { AND: [vis, { id: taskId }] },
    include: {
      vendor: true,
      assignees: true,
      activities: { orderBy: { createdAt: "asc" } },
      subtasks: { orderBy: { createdAt: "asc" } },
      items: { orderBy: { sortOrder: "asc" } },
      parent: { select: { id: true, number: true, title: true } },
    },
  });
  if (!t) return null;
  const [property, unit, tenant, lease, who, bill] = await Promise.all([
    t.propertyId ? ctx.db.property.findFirst({ where: { id: t.propertyId } }) : null,
    t.unitId ? ctx.db.unit.findFirst({ where: { id: t.unitId } }) : null,
    t.tenantId ? ctx.db.tenant.findFirst({ where: { id: t.tenantId } }) : null,
    t.leaseId ? ctx.db.lease.findFirst({ where: { id: t.leaseId } }) : null,
    names(t.assignees.map((a) => a.userId)),
    t.billId ? ctx.db.bill.findFirst({ where: { id: t.billId } }) : null,
  ]);
  return { task: t, property, unit, tenant: tenant ? { id: tenant.id, name: tenantDisplayName(tenant), email: tenant.email, phone: tenant.phone } : null, lease, assigneeNames: [...who.values()], bill };
}

/** Options for task forms: properties+units, vendors, team members. */
export async function taskFormOptions(ctx: AppContext) {
  const scope = ctx.membership.propertyScope;
  const [properties, vendors, members] = await Promise.all([
    ctx.db.property.findMany({
      where: scope.length ? { id: { in: scope } } : {},
      orderBy: { name: "asc" },
      include: { units: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
    }),
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, trades: true, email: true } }),
    ctx.db.membership.findMany({ where: { status: "ACTIVE", role: { key: { notIn: ["VENDOR", "OWNER_READONLY"] } } }, include: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  return {
    properties: properties.map((p) => ({ id: p.id, name: p.name, units: p.units })),
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, trades: v.trades, hasEmail: Boolean(v.email) })),
    members: members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email })),
  };
}
export type TaskFormOptions = Awaited<ReturnType<typeof taskFormOptions>>;
