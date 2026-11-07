import { z } from "zod";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { EVENT_TYPES, type DomainEvent } from "./events";

/**
 * Workflows: when <trigger event> and <all conditions>, do <actions>. Runs are idempotent per
 * (workflow, event) and logged step by step. Events raised by workflow actions don't re-trigger
 * workflows (no loops).
 */
export const CONDITION_OPS = ["eq", "neq", "gt", "lt", "contains"] as const;
export const ACTION_TYPES = ["SEND_EMAIL", "SEND_SMS", "CREATE_TASK", "NOTIFY_STAFF"] as const;
export const ACTION_LABEL: Record<(typeof ACTION_TYPES)[number], string> = { SEND_EMAIL: "Email the tenant / applicant", SEND_SMS: "Text the tenant", CREATE_TASK: "Create a task", NOTIFY_STAFF: "Email a team member" };

/** Fields available per trigger (for the builder and validation). */
export const TRIGGER_FIELDS: Record<string, { key: string; label: string; kind: "text" | "money" | "number" }[]> = {
  "lease.created": [{ key: "rentCents", label: "Monthly rent", kind: "money" }, { key: "propertyName", label: "Property name", kind: "text" }],
  "lease.ended": [{ key: "propertyName", label: "Property name", kind: "text" }],
  "payment.succeeded": [{ key: "amountCents", label: "Amount", kind: "money" }, { key: "method", label: "Method (CARD/ACH)", kind: "text" }],
  "payment.failed": [{ key: "amountCents", label: "Amount", kind: "money" }, { key: "method", label: "Method (CARD/ACH)", kind: "text" }, { key: "failureReason", label: "Failure reason", kind: "text" }],
  "task.created": [{ key: "type", label: "Type", kind: "text" }, { key: "priority", label: "Priority", kind: "text" }, { key: "category", label: "Category", kind: "text" }, { key: "title", label: "Title", kind: "text" }],
  "task.updated": [{ key: "status", label: "Status", kind: "text" }, { key: "priority", label: "Priority", kind: "text" }, { key: "type", label: "Type", kind: "text" }],
  "application.submitted": [{ key: "recommendation", label: "Screening recommendation", kind: "text" }],
};

export const workflowSchema = z.object({
  name: z.string().trim().min(2, "Name the workflow").max(80),
  trigger: z.enum(EVENT_TYPES),
  conditions: z.array(z.object({ field: z.string().min(1), op: z.enum(CONDITION_OPS), value: z.string().max(200) })).max(10),
  actions: z.array(z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.string(), z.string().max(2000)) })).min(1, "Add at least one action").max(10),
  active: z.boolean(),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

export async function saveWorkflow(db: ScopedDb, id: string | null, raw: WorkflowInput) {
  const v = workflowSchema.parse(raw);
  for (const c of v.conditions) if (!TRIGGER_FIELDS[v.trigger]?.some((f) => f.key === c.field)) throw new UserFacingError(`"${c.field}" isn't available for this trigger`);
  for (const a of v.actions) {
    if ((a.type === "SEND_EMAIL" || a.type === "NOTIFY_STAFF") && !(a.params.subject ?? "").trim()) throw new UserFacingError("Every email needs a subject");
    if (a.type === "NOTIFY_STAFF" && !(a.params.userId ?? "")) throw new UserFacingError("Choose who to notify");
    if (a.type === "CREATE_TASK" && !(a.params.title ?? "").trim()) throw new UserFacingError("Give the task a title");
    if ((a.type === "SEND_EMAIL" || a.type === "SEND_SMS" || a.type === "NOTIFY_STAFF") && !(a.params.body ?? "").trim()) throw new UserFacingError("Write the message");
  }
  const data = { name: v.name, trigger: v.trigger, conditions: v.conditions, actions: v.actions, active: v.active };
  const w = id ? await db.workflow.update({ where: { id }, data }) : await db.workflow.create({ data: { organizationId: db.ctx.orgId, createdById: db.ctx.userId, ...data } });
  await audit(db, { action: id ? "workflow.updated" : "workflow.created", entityType: "Workflow", entityId: w.id, after: data });
  return w;
}

const get = (data: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), data);

export function conditionMet(data: Record<string, unknown>, c: { field: string; op: string; value: string }) {
  const actual = get(data, c.field);
  const isMoney = /Cents$/.test(c.field);
  const want = isMoney ? Math.round(Number(c.value.replace(/[$,]/g, "")) * 100) : c.value;
  switch (c.op) {
    case "eq": return String(actual ?? "").toLowerCase() === String(want).toLowerCase();
    case "neq": return String(actual ?? "").toLowerCase() !== String(want).toLowerCase();
    case "gt": return Number(actual) > Number(want);
    case "lt": return Number(actual) < Number(want);
    case "contains": return String(actual ?? "").toLowerCase().includes(String(want).toLowerCase());
    default: return false;
  }
}

/** {{field}} placeholders filled from the event data. */
export const fill = (s: string, data: Record<string, unknown>) =>
  s.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, k: string) => {
    const v = get(data, k);
    return /Cents$/.test(k) && typeof v === "number" ? `$${(v / 100).toFixed(2)}` : String(v ?? "");
  });

async function contactFor(db: ScopedDb, data: Record<string, unknown>) {
  if (typeof data.email === "string") return { name: String(data.firstName ?? "there"), email: data.email, phone: null as string | null, tenantId: null as string | null };
  const tenantId = (data.tenantId as string | undefined) ?? (data.leaseId ? (await db.leaseTenant.findFirst({ where: { leaseId: data.leaseId as string, role: "PRIMARY" } }))?.tenantId : undefined);
  if (!tenantId) return null;
  const t = await db.tenant.findFirst({ where: { id: tenantId } });
  return t ? { name: t.firstName ?? t.companyName ?? "there", email: t.email, phone: t.phone, tenantId: t.id } : null;
}

export async function runWorkflowsFor(db: ScopedDb, event: DomainEvent) {
  if (event.data.source === "WORKFLOW") return 0;
  const flows = await db.workflow.findMany({ where: { trigger: event.type, active: true, deletedAt: null } });
  let ran = 0;
  for (const w of flows) {
    if (await db.workflowRun.findFirst({ where: { workflowId: w.id, eventId: event.id } })) continue;
    const conditions = w.conditions as { field: string; op: string; value: string }[];
    if (!conditions.every((c) => conditionMet(event.data, c))) {
      await db.workflowRun.create({ data: { organizationId: db.ctx.orgId, workflowId: w.id, event: event.type, eventId: event.id, status: "SKIPPED", log: [{ action: "conditions", status: "not met" }] } });
      continue;
    }
    const log: { action: string; status: string; detail?: string }[] = [];
    let failed: string | null = null;
    for (const a of w.actions as { type: string; params: Record<string, string> }[]) {
      try {
        log.push({ action: a.type, status: "done", detail: await runAction(db, a, event) });
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
        log.push({ action: a.type, status: "failed", detail: failed });
        break;
      }
    }
    await db.workflowRun.create({ data: { organizationId: db.ctx.orgId, workflowId: w.id, event: event.type, eventId: event.id, status: failed ? "FAILED" : "SUCCEEDED", log, error: failed } });
    ran++;
  }
  return ran;
}

async function runAction(db: ScopedDb, a: { type: string; params: Record<string, string> }, event: DomainEvent): Promise<string> {
  const d = event.data;
  switch (a.type) {
    case "SEND_EMAIL": {
      const c = await contactFor(db, d);
      if (!c?.email) return "skipped — no email address";
      await getEmailProvider().send({ to: c.email, organizationId: db.ctx.orgId, subject: fill(a.params.subject ?? "", d), text: fill(a.params.body ?? "", d), html: `<p style="font-family:system-ui,sans-serif;white-space:pre-wrap">${fill(a.params.body ?? "", d).replace(/[<>&]/g, (x) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[x]!)}</p>` });
      return `emailed ${c.email}`;
    }
    case "SEND_SMS": {
      const c = await contactFor(db, d);
      if (!c?.tenantId) return "skipped — no tenant";
      const { findOrCreateConversation, sendMessage } = await import("@/server/comms/service");
      const conv = await findOrCreateConversation(db, { tenantId: c.tenantId });
      await sendMessage(db, conv.id, { body: fill(a.params.body ?? "", d), channel: "SMS", author: { userId: null, name: "Automation" } });
      return `texted ${c.name}`;
    }
    case "CREATE_TASK": {
      const { createTask } = await import("@/server/maintenance/tasks");
      const t = await createTask(db, { title: fill(a.params.title ?? "Follow up", d), description: fill(a.params.description ?? "", d) || undefined, priority: (a.params.priority as "NORMAL") || "NORMAL", propertyId: (d.propertyId as string) ?? undefined, leaseId: (d.leaseId as string) ?? undefined, assigneeIds: a.params.assigneeId ? [a.params.assigneeId] : undefined }, { userId: null, name: "Automation", kind: "SYSTEM" });
      return `created task #${t.number}`;
    }
    case "NOTIFY_STAFF": {
      const m = await db.membership.findFirst({ where: { userId: a.params.userId }, include: { user: true } });
      if (!m) return "skipped — team member not found";
      await getEmailProvider().send({ to: m.user.email, organizationId: db.ctx.orgId, subject: fill(a.params.subject ?? "", d), text: fill(a.params.body ?? "", d), html: `<p style="font-family:system-ui,sans-serif;white-space:pre-wrap">${fill(a.params.body ?? "", d).replace(/[<>&]/g, (x) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[x]!)}</p>` });
      return `emailed ${m.user.email}`;
    }
    default:
      throw new Error(`Unknown action ${a.type}`);
  }
}
