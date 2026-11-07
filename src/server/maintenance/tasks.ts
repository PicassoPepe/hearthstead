import { emit } from "@/server/platform/events";
import type { Prisma, TaskStatus } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { getSettings } from "@/server/settings/service";
import { parseISODate } from "@/lib/dates";
import { INSPECTION_TEMPLATE, PUBLIC_STATUS_TEXT, STATUS_LABEL, TASK_TYPE_LABEL, categoryLabel, taskInputSchema, type TaskInput } from "@/lib/maintenance";
import { tenantDisplayName } from "@/lib/leasing";

/** Who's acting: staff user, tenant (portal), or the system. Used for activity + permissions. */
export type TaskActor = { userId: string | null; name: string; kind: "STAFF" | "TENANT" | "OWNER" | "VENDOR" | "SYSTEM" };

/**
 * Which tasks a member may see. Vendors only see tasks assigned to their vendor record (work
 * orders and tenant requests routed to them);
 * members limited to certain properties only see tasks on those properties.
 */
export async function taskVisibility(db: ScopedDb, member: { userId: string; roleKey: string | null; propertyScope: string[] }): Promise<Prisma.TaskWhereInput> {
  const where: Prisma.TaskWhereInput = {};
  if (member.roleKey === "VENDOR") {
    const vendors = await db.vendor.findMany({ where: { userId: member.userId }, select: { id: true } });
    where.vendorId = { in: vendors.map((v) => v.id) };
  }
  if (member.propertyScope.length) where.propertyId = { in: member.propertyScope };
  return where;
}

async function nextNumber(db: ScopedDb): Promise<number> {
  const max = await db.task.aggregate({ where: { deletedAt: undefined }, _max: { number: true } });
  return Math.max(1000, max._max.number ?? 1000) + 1;
}

export async function addActivity(db: ScopedDb, taskId: string, actor: TaskActor, kind: string, body: string, isPublic = false) {
  await db.taskActivity.create({ data: { organizationId: db.ctx.orgId, taskId, kind, body, public: isPublic, actorId: actor.userId, actorName: actor.name } });
}

/** Auto-assign rules from settings (property overrides company). */
async function autoAssign(db: ScopedDb, category: string | null | undefined, propertyId: string | null | undefined) {
  if (!category) return null;
  const s = await getSettings(db, ["maintenance.autoAssignRules"], { orgId: db.ctx.orgId, propertyId: propertyId ?? undefined });
  return s["maintenance.autoAssignRules"].value.find((r) => r.category === category) ?? null;
}

async function notifyVendor(db: ScopedDb, taskId: string) {
  const t = await db.task.findFirstOrThrow({ where: { id: taskId }, include: { vendor: true } });
  if (!t.vendor?.email) return false;
  const property = t.propertyId ? await db.property.findFirst({ where: { id: t.propertyId } }) : null;
  const unit = t.unitId ? await db.unit.findFirst({ where: { id: t.unitId } }) : null;
  const org = await db.organization.findFirstOrThrow({ where: { id: db.ctx.orgId } });
  const where = property ? `${property.addressLine1}${unit && unit.name !== "Main" ? `, Unit ${unit.name}` : ""}, ${property.city}` : "See details";
  await getEmailProvider().send({
    to: t.vendor.email,
    organizationId: db.ctx.orgId,
    subject: `Work order #${t.number}: ${t.title}`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a"><h1 style="font-size:18px">Work order #${t.number} from ${org.name}</h1><p><strong>${t.title}</strong></p><p>${(t.description ?? "").replace(/</g, "&lt;")}</p><p><strong>Where:</strong> ${where}<br><strong>Priority:</strong> ${t.priority.toLowerCase()}${t.dueDate ? `<br><strong>Due:</strong> ${t.dueDate.toISOString().slice(0, 10)}` : ""}${t.permissionToEnter ? "<br><strong>Permission to enter:</strong> yes" : ""}${t.preferredTimes ? `<br><strong>Preferred times:</strong> ${t.preferredTimes}` : ""}</p><p>Reply to this email or call ${org.phone ?? "the office"} to schedule.</p></body></html>`,
    text: `Work order #${t.number}: ${t.title}\n${t.description ?? ""}\nWhere: ${where}`,
  });
  return true;
}

export async function createTask(db: ScopedDb, raw: TaskInput, actor: TaskActor): Promise<{ id: string; number: number }> {
  const v = taskInputSchema.parse(raw);
  // Validate every link belongs to this org (scoped lookups) and is consistent.
  let propertyId = v.propertyId || null;
  if (v.unitId) {
    const unit = await db.unit.findFirst({ where: { id: v.unitId } });
    if (!unit) throw new UserFacingError("Choose a valid unit", { unitId: "Choose a valid unit" });
    propertyId = unit.propertyId;
  }
  if (v.leaseId) {
    const lease = await db.lease.findFirst({ where: { id: v.leaseId } });
    if (!lease) throw new UserFacingError("Lease not found");
    propertyId ??= lease.propertyId;
  }
  if (propertyId && !(await db.property.findFirst({ where: { id: propertyId } }))) throw new UserFacingError("Choose a valid property", { propertyId: "Choose a valid property" });
  let vendorId = v.vendorId || null;
  if (vendorId && !(await db.vendor.findFirst({ where: { id: vendorId } }))) throw new UserFacingError("Choose a valid vendor", { vendorId: "Choose a valid vendor" });
  if (v.parentTaskId && !(await db.task.findFirst({ where: { id: v.parentTaskId } }))) throw new UserFacingError("Parent task not found");
  let assigneeIds = [...new Set(v.assigneeIds)];
  if (assigneeIds.length) {
    const members = await db.membership.findMany({ where: { userId: { in: assigneeIds }, status: "ACTIVE" }, select: { userId: true } });
    if (members.length !== assigneeIds.length) throw new UserFacingError("Assignees must be on your team", { assigneeIds: "Choose team members" });
  }
  // Auto-assign (tenant requests and anything without an assignee/vendor yet).
  const rule = await autoAssign(db, v.category, propertyId);
  if (rule) {
    if (!assigneeIds.length && rule.userId) assigneeIds = [rule.userId];
    if (!vendorId && rule.vendorId && (v.type === "WORK_ORDER" || v.type === "TENANT_REQUEST")) vendorId = rule.vendorId;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const number = await nextNumber(db);
      const task = await db.tx(async (tx) => {
        const t = await tx.task.create({
          data: {
            organizationId: db.ctx.orgId, number, type: v.type, priority: v.priority, title: v.title, description: v.description || null, category: v.category || null,
            dueDate: v.dueDate ? parseISODate(v.dueDate) : null, propertyId, unitId: v.unitId || null, leaseId: v.leaseId || null, tenantId: v.tenantId || null,
            vendorId, parentTaskId: v.parentTaskId || null, estimateCents: v.estimateCents ?? null, permissionToEnter: v.permissionToEnter ?? null,
            preferredTimes: v.preferredTimes || null, inspectionKind: v.type === "INSPECTION" ? (v.inspectionKind ?? "PERIODIC") : null,
            source: actor.kind === "TENANT" || actor.kind === "OWNER" ? "PORTAL" : actor.kind === "SYSTEM" ? "WORKFLOW" : "STAFF", createdById: actor.userId,
          },
        });
        if (assigneeIds.length) await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ organizationId: db.ctx.orgId, taskId: t.id, userId })) });
        if (v.type === "INSPECTION") {
          let order = 0;
          await tx.inspectionItem.createMany({ data: INSPECTION_TEMPLATE.flatMap((r) => r.items.map((item) => ({ organizationId: db.ctx.orgId, taskId: t.id, room: r.room, item, sortOrder: order++ }))) });
        }
        return t;
      });
      await addActivity(db, task.id, actor, "CREATED", `${TASK_TYPE_LABEL[v.type]} created${actor.kind === "TENANT" ? " from the tenant portal" : actor.kind === "OWNER" ? " from the owner portal" : ""}${rule ? " · auto-assigned by rule" : ""}`, v.type === "TENANT_REQUEST");
      if (vendorId) {
        const vendor = await db.vendor.findFirstOrThrow({ where: { id: vendorId } });
        await addActivity(db, task.id, actor, "VENDOR", `Assigned to ${vendor.name}`);
        if (v.notifyVendor && (await notifyVendor(db, task.id))) await addActivity(db, task.id, actor, "VENDOR", `Work order emailed to ${vendor.email}`);
      }
      await audit(db, { action: "task.created", entityType: "Task", entityId: task.id, actorType: actor.kind === "SYSTEM" ? "SYSTEM" : "USER", after: { number, type: v.type, title: v.title } });
      await emit(db, "task.created", { taskId: task.id, number, type: v.type, title: v.title, status: task.status, priority: v.priority, category: v.category ?? null, propertyId, tenantId: v.tenantId || null, source: task.source });
      return { id: task.id, number };
    } catch (e) {
      if (attempt < 3 && typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") continue; // number race
      throw e;
    }
  }
}

/** Status change (optimistic in the UI). Tenants get an email when their request moves. */
export async function setTaskStatus(db: ScopedDb, taskId: string, status: TaskStatus, actor: TaskActor): Promise<void> {
  const t = await db.task.findFirst({ where: { id: taskId } });
  if (!t) throw new UserFacingError("Task not found");
  if (t.status === status) return;
  if (status === "COMPLETED") {
    const open = await db.task.count({ where: { parentTaskId: taskId, status: { notIn: ["COMPLETED", "ARCHIVED"] } } });
    if (open) throw new UserFacingError(`Finish the ${open} open subtask${open === 1 ? "" : "s"} first.`);
  }
  await db.task.update({ where: { id: taskId }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
  await addActivity(db, taskId, actor, "STATUS", `Status: ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[status]}`, t.type === "TENANT_REQUEST");
  await audit(db, { action: "task.status_changed", entityType: "Task", entityId: taskId, before: { status: t.status }, after: { status } });
  await emit(db, "task.updated", { taskId, number: t.number, type: t.type, title: t.title, status, previousStatus: t.status, priority: t.priority, propertyId: t.propertyId, tenantId: t.tenantId, source: actor.kind === "SYSTEM" && actor.name === "Automation" ? "WORKFLOW" : t.source });
  if (t.tenantId && t.type === "TENANT_REQUEST") await notifyTenant(db, t.id, `Update on your request: ${PUBLIC_STATUS_TEXT[status]}`);
}

async function notifyTenant(db: ScopedDb, taskId: string, line: string) {
  const t = await db.task.findFirstOrThrow({ where: { id: taskId } });
  if (!t.tenantId) return;
  const s = await getSettings(db, ["maintenance.notifyTenantOnUpdate"], { orgId: db.ctx.orgId, propertyId: t.propertyId ?? undefined });
  if (!s["maintenance.notifyTenantOnUpdate"].value) return;
  const tenant = await db.tenant.findFirst({ where: { id: t.tenantId } });
  if (!tenant?.email) return;
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  await getEmailProvider().send({
    to: tenant.email,
    organizationId: db.ctx.orgId,
    subject: `Request #${t.number}: ${PUBLIC_STATUS_TEXT[t.status]}`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px"><p>Hi ${tenantDisplayName(tenant)},</p><p>${line} — <strong>${t.title}</strong>.</p><p><a href="${base}/portal/tenant/requests/${t.id}">View your request</a></p></body></html>`,
    text: `${line} — ${t.title}. ${base}/portal/tenant/requests/${t.id}`,
  });
}

export async function updateTask(db: ScopedDb, taskId: string, patch: { priority?: string; dueDate?: string | null; vendorId?: string | null; assigneeIds?: string[]; estimateCents?: number | null; title?: string; description?: string; notifyVendor?: boolean }, actor: TaskActor) {
  const t = await db.task.findFirst({ where: { id: taskId }, include: { assignees: true } });
  if (!t) throw new UserFacingError("Task not found");
  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (patch.priority && patch.priority !== t.priority) {
    data.priority = patch.priority as never;
    await addActivity(db, taskId, actor, "STATUS", `Priority set to ${patch.priority.toLowerCase()}`);
  }
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate ? parseISODate(patch.dueDate) : null;
  if (patch.estimateCents !== undefined) data.estimateCents = patch.estimateCents;
  if (patch.title !== undefined) data.title = patch.title.trim() || t.title;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.vendorId !== undefined && patch.vendorId !== t.vendorId) {
    if (patch.vendorId && !(await db.vendor.findFirst({ where: { id: patch.vendorId } }))) throw new UserFacingError("Choose a valid vendor");
    data.vendorId = patch.vendorId;
    if (patch.vendorId && t.type === "TASK") data.type = "WORK_ORDER";
  }
  await db.task.update({ where: { id: taskId }, data });
  if (patch.vendorId !== undefined && patch.vendorId !== t.vendorId) {
    const vendor = patch.vendorId ? await db.vendor.findFirst({ where: { id: patch.vendorId } }) : null;
    await addActivity(db, taskId, actor, "VENDOR", vendor ? `Assigned to ${vendor.name}` : "Vendor removed", Boolean(vendor) && t.type === "TENANT_REQUEST");
    if (vendor && patch.notifyVendor && (await notifyVendor(db, taskId))) await addActivity(db, taskId, actor, "VENDOR", `Work order emailed to ${vendor.email}`);
  }
  if (patch.assigneeIds) {
    const ids = [...new Set(patch.assigneeIds)];
    const members = await db.membership.findMany({ where: { userId: { in: ids }, status: "ACTIVE" }, select: { userId: true } });
    if (members.length !== ids.length) throw new UserFacingError("Assignees must be on your team");
    await db.tx(async (tx) => {
      await tx.taskAssignee.deleteMany({ where: { taskId } });
      if (ids.length) await tx.taskAssignee.createMany({ data: ids.map((userId) => ({ organizationId: db.ctx.orgId, taskId, userId })) });
    });
    const assigned = await db.membership.findMany({ where: { userId: { in: ids } }, include: { user: { select: { name: true, email: true } } } });
    await addActivity(db, taskId, actor, "ASSIGNED", ids.length ? `Assigned to ${assigned.map((m) => m.user.name ?? m.user.email).join(", ")}` : "Unassigned");
  }
  await audit(db, { action: "task.updated", entityType: "Task", entityId: taskId, after: patch });
  await emit(db, "task.updated", { taskId, number: t.number, type: t.type, title: patch.title ?? t.title, status: t.status, priority: patch.priority ?? t.priority, propertyId: t.propertyId, tenantId: t.tenantId, changes: Object.keys(patch) });
}

export async function commentOnTask(db: ScopedDb, taskId: string, body: string, isPublic: boolean, actor: TaskActor) {
  const text = body.trim();
  if (!text) throw new UserFacingError("Write a comment first");
  if (text.length > 5000) throw new UserFacingError("Comments are limited to 5,000 characters");
  const t = await db.task.findFirst({ where: { id: taskId } });
  if (!t) throw new UserFacingError("Task not found");
  await addActivity(db, taskId, actor, "COMMENT", text, isPublic);
  if (isPublic && actor.kind !== "TENANT" && t.type === "TENANT_REQUEST") await notifyTenant(db, taskId, `${actor.name} replied: "${text.slice(0, 200)}"`);
}

export { categoryLabel };
