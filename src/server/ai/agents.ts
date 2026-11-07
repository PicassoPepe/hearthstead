import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { addDays } from "@/lib/dates";

/**
 * Background agents. Each run looks for work, then either PROPOSES an action for a human to
 * approve, or (mode AUTO and confidence ≥ threshold) EXECUTES it. Every action is logged with its
 * confidence and outcome; each (agent, kind, entity) is handled once.
 */
export const AGENTS = {
  RECEPTIONIST: { label: "Receptionist", description: "Drafts replies to new tenant and owner messages." },
  MAINTENANCE: { label: "Maintenance", description: "Triages new tenant requests: category, priority and vendor." },
  RENEWALS: { label: "Renewals", description: "Proposes renewal offers for leases ending in 60–90 days." },
} as const;
export type AgentKey = keyof typeof AGENTS;

export async function agentConfigs(db: ScopedDb) {
  const rows = await db.agentConfig.findMany();
  return (Object.keys(AGENTS) as AgentKey[]).map((agent) => rows.find((r) => r.agent === agent) ?? { agent, enabled: false, mode: "APPROVAL", threshold: 80, settings: {}, lastRunAt: null });
}

export async function saveAgentConfig(db: ScopedDb, agent: AgentKey, v: { enabled: boolean; mode: "AUTO" | "APPROVAL"; threshold: number; settings?: Record<string, unknown> }) {
  if (!(agent in AGENTS)) throw new UserFacingError("Unknown agent");
  if (!Number.isInteger(v.threshold) || v.threshold < 50 || v.threshold > 100) throw new UserFacingError("Threshold must be 50–100");
  await db.agentConfig.upsert({ where: { organizationId_agent: { organizationId: db.ctx.orgId, agent } }, update: { enabled: v.enabled, mode: v.mode, threshold: v.threshold, settings: (v.settings ?? {}) as object }, create: { organizationId: db.ctx.orgId, agent, enabled: v.enabled, mode: v.mode, threshold: v.threshold, settings: (v.settings ?? {}) as object } });
  await audit(db, { action: "agent.configured", entityType: "Agent", entityId: agent, after: v });
}

const URGENT = /\b(flood|flooding|gas|smoke|fire|sparking|no heat|no water|sewage|burst|carbon monoxide|locked out)\b/i;
const CATEGORY: [RegExp, string][] = [[/leak|drip|toilet|sink|drain|clog|faucet|water heater|pipe|shower/i, "PLUMBING"], [/outlet|light|breaker|switch|power|electric|sparking/i, "ELECTRICAL"], [/heat|furnace|ac\b|air condition|hvac|thermostat|cold/i, "HVAC"], [/fridge|refrigerator|stove|oven|dishwasher|washer|dryer|microwave/i, "APPLIANCE"], [/lock|key|door won/i, "LOCKSMITH"], [/mouse|mice|roach|bug|pest|ant\b|bees/i, "PEST"]];

type Proposal = { kind: string; entityType: string; entityId: string; summary: string; confidence: number; payload: Record<string, unknown> };

async function record(db: ScopedDb, agent: AgentKey, cfg: { mode: string; threshold: number }, p: Proposal) {
  if (await db.agentAction.findFirst({ where: { agent, kind: p.kind, entityType: p.entityType, entityId: p.entityId } })) return null;
  const a = await db.agentAction.create({ data: { organizationId: db.ctx.orgId, agent, ...p, payload: p.payload as object } });
  if (cfg.mode === "AUTO" && p.confidence >= cfg.threshold) await execute(db, a.id, null);
  return a;
}

/** Find work for every enabled agent. */
export async function runAgents(db: ScopedDb, now = new Date()) {
  const cfgs = (await agentConfigs(db)).filter((c) => c.enabled);
  let proposed = 0;
  for (const cfg of cfgs) {
    const agent = cfg.agent as AgentKey;
    if (agent === "RECEPTIONIST") {
      const convs = await db.conversation.findMany({ where: { unreadCount: { gt: 0 }, status: "OPEN", OR: [{ tenantId: { not: null } }, { ownerId: { not: null } }] }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } }, take: 25 });
      const { draftReply } = await import("@/server/comms/service");
      for (const c of convs) {
        const last = c.messages[0];
        if (!last || last.direction !== "IN") continue;
        if (await db.agentAction.findFirst({ where: { agent, kind: "REPLY_MESSAGE", entityType: "Message", entityId: last.id } })) continue;
        const draft = await draftReply(db, c.id, "The team");
        const routine = /rent|pay|balance|portal|autopay|thank/i.test(last.body) && !/legal|lawyer|evict|discriminat|injur/i.test(last.body);
        if (await record(db, agent, cfg, { kind: "REPLY_MESSAGE", entityType: "Message", entityId: last.id, summary: `Reply to “${last.body.slice(0, 80)}”`, confidence: routine ? 90 : 65, payload: { conversationId: c.id, channel: last.channel === "SMS" ? "SMS" : "PORTAL", body: draft } })) proposed++;
      }
    }
    if (agent === "MAINTENANCE") {
      const tasks = await db.task.findMany({ where: { type: "TENANT_REQUEST", status: "NOT_STARTED", vendorId: null }, take: 25 });
      const vendors = await db.vendor.findMany({ where: { deletedAt: null } });
      for (const t of tasks) {
        const text = `${t.title} ${t.description ?? ""}`;
        const category = t.category ?? CATEGORY.find(([re]) => re.test(text))?.[1] ?? "GENERAL";
        const priority = URGENT.test(text) ? "URGENT" : t.priority;
        const vendor = vendors.find((v) => v.trades.includes(category));
        const confidence = CATEGORY.some(([re]) => re.test(text)) ? (vendor ? 88 : 75) : 55;
        if (await record(db, agent, cfg, { kind: "TRIAGE_REQUEST", entityType: "Task", entityId: t.id, summary: `#${t.number} ${t.title} → ${category.toLowerCase()}, ${priority.toLowerCase()}${vendor ? `, assign ${vendor.name}` : ""}`, confidence, payload: { taskId: t.id, category, priority, vendorId: vendor?.id ?? null } })) proposed++;
      }
    }
    if (agent === "RENEWALS") {
      const { renewalCandidates } = await import("@/server/funnel/renewals");
      const max = Number((cfg.settings as { maxAutoIncreasePct?: number }).maxAutoIncreasePct ?? 5);
      for (const c of (await renewalCandidates(db, now, 90)).filter((x) => !x.offer && new Date(x.endDate) >= addDays(now, 60))) {
        const pct = c.rentCents ? ((c.suggestedCents - c.rentCents) / c.rentCents) * 100 : 0;
        if (await record(db, agent, cfg, { kind: "RENEWAL_OFFER", entityType: "Lease", entityId: c.leaseId, summary: `${c.label}: offer ${(c.suggestedCents / 100).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%) for 12 months`, confidence: pct <= max ? 85 : 60, payload: { leaseId: c.leaseId, newRentCents: c.suggestedCents, termMonths: 12 } })) proposed++;
      }
    }
    await db.agentConfig.updateMany({ where: { agent }, data: { lastRunAt: now } });
  }
  return proposed;
}

/** Execute an action (approval by a person, or automatically). */
export async function execute(db: ScopedDb, actionId: string, decidedById: string | null) {
  const a = await db.agentAction.findFirst({ where: { id: actionId } });
  if (!a) throw new UserFacingError("Action not found");
  if (a.status !== "PROPOSED") throw new UserFacingError(`Already ${a.status.toLowerCase()}`);
  const p = a.payload as Record<string, string | number | null>;
  let result: string;
  try {
    if (a.kind === "REPLY_MESSAGE") {
      const { sendMessage } = await import("@/server/comms/service");
      await sendMessage(db, String(p.conversationId), { body: String(p.body), channel: p.channel === "SMS" ? "SMS" : "PORTAL", author: { userId: decidedById, name: "Receptionist agent" }, aiDrafted: true });
      result = "Reply sent";
    } else if (a.kind === "TRIAGE_REQUEST") {
      const { updateTask } = await import("@/server/maintenance/tasks");
      await db.task.update({ where: { id: String(p.taskId) }, data: { category: String(p.category) } });
      await updateTask(db, String(p.taskId), { priority: String(p.priority), ...(p.vendorId ? { vendorId: String(p.vendorId) } : {}) }, { userId: decidedById, name: "Maintenance agent", kind: "SYSTEM" });
      result = "Request triaged";
    } else if (a.kind === "RENEWAL_OFFER") {
      const { sendRenewalOffer } = await import("@/server/funnel/renewals");
      const admin = await adminDb.membership.findFirst({ where: { organizationId: db.ctx.orgId, role: { key: "ADMIN" } }, include: { user: true }, orderBy: { createdAt: "asc" } });
      await sendRenewalOffer(db, { leaseId: String(p.leaseId), newRentCents: Number(p.newRentCents), termMonths: Number(p.termMonths) }, { name: admin?.user.name ?? "Manager", email: admin?.user.email ?? "office@example.com" });
      result = "Renewal offer sent for signature";
    } else throw new Error("Unknown action");
    await db.agentAction.update({ where: { id: a.id }, data: { status: "EXECUTED", result, decidedById, decidedAt: new Date() } });
  } catch (e) {
    result = e instanceof Error ? e.message : "Failed";
    await db.agentAction.update({ where: { id: a.id }, data: { status: "FAILED", result, decidedById, decidedAt: new Date() } });
  }
  await audit(db, { action: decidedById ? "agent.action_approved" : "agent.action_auto_executed", entityType: "AgentAction", entityId: a.id, actorType: decidedById ? "USER" : "AI", after: { agent: a.agent, kind: a.kind, result } });
  return result;
}

export async function reject(db: ScopedDb, actionId: string, userId: string) {
  const a = await db.agentAction.findFirst({ where: { id: actionId } });
  if (!a || a.status !== "PROPOSED") throw new UserFacingError("Only proposed actions can be rejected");
  await db.agentAction.update({ where: { id: actionId }, data: { status: "REJECTED", decidedById: userId, decidedAt: new Date() } });
  await audit(db, { action: "agent.action_rejected", entityType: "AgentAction", entityId: actionId });
}
