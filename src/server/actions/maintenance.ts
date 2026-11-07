"use server";

import { revalidatePath } from "next/cache";
import type { TaskStatus } from "@prisma/client";
import { getContext, requirePermission, type AppContext } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { can, canAccessProperty, PermissionError } from "@/server/permissions";
import * as T from "@/server/maintenance/tasks";
import { archiveVendor, saveVendor } from "@/server/maintenance/vendors";
import { createBill } from "@/server/maintenance/bills";
import { saveInspectionItem, summarizeInspection } from "@/server/maintenance/inspections";
import { setSetting } from "@/server/settings/service";
import { audit } from "@/server/audit";
import { TASK_STATUSES, type TaskInput, type VendorInput } from "@/lib/maintenance";
import { parseMoney } from "@/lib/money";

const refresh = () => revalidatePath("/app", "layout");
const actor = (ctx: AppContext): T.TaskActor => ({ userId: ctx.user.id, name: ctx.user.name ?? ctx.user.email, kind: ctx.membership.roleKey === "VENDOR" ? "VENDOR" : "STAFF" });

/** Load a task the member is allowed to see (vendor + property scoping), or throw. */
async function visibleTask(ctx: AppContext, taskId: string) {
  const where = await T.taskVisibility(ctx.db, { userId: ctx.user.id, roleKey: ctx.membership.roleKey, propertyScope: ctx.membership.propertyScope });
  const t = await ctx.db.task.findFirst({ where: { ...where, id: taskId } });
  if (!t) throw new UserFacingError("Task not found");
  return t;
}

/** Edit = tasks:edit. Vendors (tasks:view) may update status/comment on their own work orders. */
async function taskWriter(taskId: string, allowVendor = false) {
  const ctx = await getContext();
  if (!ctx) throw new PermissionError("tasks", "edit");
  const isVendor = ctx.membership.roleKey === "VENDOR";
  if (!(can(ctx.permissions, "tasks", "edit") || (allowVendor && isVendor))) throw new PermissionError("tasks", "edit");
  const task = await visibleTask(ctx, taskId);
  return { ctx, task };
}

export async function createTaskAction(input: TaskInput): Promise<ActionResult<{ id: string; number: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("tasks", "edit");
    if (ctx.membership.roleKey === "VENDOR") throw new UserFacingError("Vendors can't create tasks.");
    if (input.propertyId && !canAccessProperty(ctx.membership.propertyScope, input.propertyId)) throw new UserFacingError("You don't have access to that property.");
    const r = await T.createTask(ctx.db, input, actor(ctx));
    refresh();
    return r;
  }, "Task created");
}

export async function setTaskStatusAction(taskId: string, status: TaskStatus): Promise<ActionResult> {
  return runAction(async () => {
    if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new UserFacingError("Invalid status");
    const { ctx } = await taskWriter(taskId, true);
    if (ctx.membership.roleKey === "VENDOR" && status === "ARCHIVED") throw new UserFacingError("Vendors can't archive work orders.");
    await T.setTaskStatus(ctx.db, taskId, status, actor(ctx));
    refresh();
  }, "Status updated");
}

export async function updateTaskAction(taskId: string, patch: Parameters<typeof T.updateTask>[2]): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await taskWriter(taskId);
    await T.updateTask(ctx.db, taskId, patch, actor(ctx));
    refresh();
  }, "Task updated");
}

export async function commentAction(taskId: string, body: string, isPublic: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await taskWriter(taskId, true);
    await T.commentOnTask(ctx.db, taskId, body, ctx.membership.roleKey === "VENDOR" ? false : isPublic, actor(ctx));
    refresh();
  }, "Comment added");
}

export async function saveVendorAction(id: string | null, input: VendorInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "edit");
    const r = await saveVendor(ctx.db, id, input);
    refresh();
    return r;
  }, id ? "Vendor saved" : "Vendor created");
}

export async function archiveVendorAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("people", "delete");
    await archiveVendor(ctx.db, id, archived);
    refresh();
  }, archived ? "Vendor archived" : "Vendor restored");
}

export async function saveInspectionItemAction(taskId: string, itemId: string, patch: { condition?: string | null; note?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    const { ctx } = await taskWriter(taskId);
    const item = await ctx.db.inspectionItem.findFirst({ where: { id: itemId, taskId } });
    if (!item) throw new UserFacingError("Item not found");
    await saveInspectionItem(ctx.db, itemId, patch);
    revalidatePath(`/app/tasks/${taskId}`);
  });
}

export async function summarizeInspectionAction(taskId: string): Promise<ActionResult<{ summary: string }>> {
  return runAction(async () => {
    const { ctx } = await taskWriter(taskId);
    if (!can(ctx.permissions, "ai", "view")) throw new UserFacingError("Your role doesn't include the AI assistant.");
    const summary = await summarizeInspection(ctx.db, taskId, actor(ctx));
    refresh();
    return { summary };
  }, "Summary ready");
}

/** "Convert vendor invoice → Bill" from a work order. */
export async function billFromWorkOrder(taskId: string, input: { billNumber: string; billDate: string; dueDate: string; amount: string; accountId: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const t = await visibleTask(ctx, taskId);
    if (!t.vendorId) throw new UserFacingError("Assign a vendor first");
    const amount = parseMoney(input.amount);
    if (!amount || amount <= 0) throw new UserFacingError("Enter the invoice amount", { amount: "Enter the invoice amount" });
    const r = await createBill(ctx.db, {
      vendorId: t.vendorId, billNumber: input.billNumber, billDate: input.billDate, dueDate: input.dueDate, taskId,
      memo: `Work order #${t.number}: ${t.title}`,
      lines: [{ accountId: input.accountId, amountCents: amount, description: t.title, propertyId: t.propertyId, unitId: t.unitId }],
    }, actor(ctx));
    refresh();
    return r;
  }, "Bill created from invoice");
}

export async function saveAutoAssignRules(rules: { category: string; userId: string | null; vendorId: string | null }[]): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const clean = rules.filter((r) => r.category && (r.userId || r.vendorId));
    const vendors = clean.map((r) => r.vendorId).filter((x): x is string => !!x);
    if (vendors.length && (await ctx.db.vendor.count({ where: { id: { in: vendors } } })) !== new Set(vendors).size) throw new UserFacingError("Choose valid vendors");
    const users = clean.map((r) => r.userId).filter((x): x is string => !!x);
    if (users.length && (await ctx.db.membership.count({ where: { userId: { in: users } } })) !== new Set(users).size) throw new UserFacingError("Choose team members");
    const { before } = await setSetting(ctx.db, "maintenance.autoAssignRules", "ORG", ctx.org.id, clean);
    await audit(ctx.db, { action: "setting.updated", entityType: "Setting", entityId: `ORG:${ctx.org.id}:maintenance.autoAssignRules`, before, after: clean });
    refresh();
  }, "Auto-assign rules saved");
}
