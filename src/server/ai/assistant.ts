import type { AppContext } from "@/server/context";
import { can } from "@/server/permissions";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getLlmProvider, type ChatTurn, type LlmTool } from "@/adapters/llm";
import { runReport } from "@/server/reports/engine";
import { orgToday, occupiedUnitIds } from "@/server/leasing/queries";
import * as M from "@/server/leasing/money";
import { normalizeParams, reportDefaults } from "@/lib/reports";
import { formatMoney } from "@/lib/money";
import { tenantDisplayName } from "@/lib/leasing";

/**
 * The in-app assistant. Read tools run immediately (respecting the user's permissions and
 * property scope). Write tools never run on their own: they come back as a proposal the user must
 * confirm, and confirmed actions are audit-logged as AI-initiated.
 */
export type ProposedAction = { id: string; tool: "create_task" | "send_message"; input: Record<string, unknown>; summary: string };
export type AssistantReply = { text: string; turns: ChatTurn[]; proposals: ProposedAction[]; toolsUsed: string[] };

const TOOLS: (LlmTool & { write?: boolean; module: Parameters<typeof can>[1] })[] = [
  { name: "search", module: "people", description: "Search tenants, owners, vendors and properties by name.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_tenant_balance", module: "leasing", description: "Current ledger balance for a tenant by name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "list_delinquent", module: "leasing", description: "Tenants who owe money, largest balance first.", input_schema: { type: "object", properties: {} } },
  { name: "list_vacancies", module: "rentals", description: "Vacant units with market rent.", input_schema: { type: "object", properties: {} } },
  { name: "list_open_tasks", module: "tasks", description: "Open tasks and work orders, urgent first.", input_schema: { type: "object", properties: {} } },
  { name: "report_summary", module: "reports", description: "Headline figures from a report (profit-loss, rent-roll, delinquency, cash-flow, balance-sheet).", input_schema: { type: "object", properties: { report: { type: "string", enum: ["profit-loss", "rent-roll", "delinquency", "cash-flow", "balance-sheet"] } }, required: ["report"] } },
  { name: "create_task", module: "tasks", write: true, description: "Propose creating a task. The user must confirm.", input_schema: { type: "object", properties: { title: { type: "string" }, propertyName: { type: "string" }, priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] } }, required: ["title"] } },
  { name: "send_message", module: "communications", write: true, description: "Propose sending a portal message or text to a tenant. The user must confirm.", input_schema: { type: "object", properties: { name: { type: "string" }, body: { type: "string" }, channel: { type: "string", enum: ["PORTAL", "SMS"] } }, required: ["name", "body"] } },
];

async function findTenant(ctx: AppContext, name: string) {
  const parts = name.trim().split(/\s+/);
  const all = await ctx.db.tenant.findMany({ where: { OR: [{ firstName: { contains: parts[0], mode: "insensitive" } }, { lastName: { contains: parts.at(-1), mode: "insensitive" } }, { companyName: { contains: name, mode: "insensitive" } }] }, take: 20 });
  const exact = all.filter((t) => tenantDisplayName(t).toLowerCase() === name.toLowerCase());
  return exact.length ? exact : all;
}

async function runReadTool(ctx: AppContext, name: string, input: Record<string, unknown>): Promise<string> {
  const scope = ctx.membership.propertyScope;
  switch (name) {
    case "search": {
      const q = String(input.query ?? "").trim();
      if (!q) return "Nothing to search for.";
      const [t, o, v, p] = await Promise.all([
        ctx.db.tenant.findMany({ where: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }, take: 5 }),
        ctx.db.owner.findMany({ where: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }] }, take: 5 }),
        ctx.db.vendor.findMany({ where: { name: { contains: q, mode: "insensitive" } }, take: 5 }),
        ctx.db.property.findMany({ where: { name: { contains: q, mode: "insensitive" }, ...(scope.length ? { id: { in: scope } } : {}) }, take: 5 }),
      ]);
      const lines = [...t.map((x) => `Tenant: ${tenantDisplayName(x)}${x.email ? ` (${x.email})` : ""}`), ...o.map((x) => `Owner: ${[x.firstName, x.lastName].filter(Boolean).join(" ") || x.companyName}`), ...v.map((x) => `Vendor: ${x.name}`), ...p.map((x) => `Property: ${x.name}, ${x.city}`)];
      return lines.length ? `Found:\n- ${lines.join("\n- ")}` : `No matches for “${q}”.`;
    }
    case "get_tenant_balance": {
      const matches = await findTenant(ctx, String(input.name ?? ""));
      if (!matches.length) return `I couldn't find a tenant named “${input.name}”.`;
      const out: string[] = [];
      for (const t of matches.slice(0, 3)) {
        const leases = await ctx.db.leaseTenant.findMany({ where: { tenantId: t.id, lease: { status: { in: ["ACTIVE", "EVICTION", "ENDED"] }, ...(scope.length ? { propertyId: { in: scope } } : {}) } }, include: { lease: { include: { property: true, units: { include: { unit: true } } } } } });
        for (const l of leases) {
          const b = await ctx.db.tx((tx) => M.leaseBalance(tx, l.leaseId));
          out.push(`${tenantDisplayName(t)} — ${l.lease.property.name} ${l.lease.units.map((u) => u.unit.name).join(", ")}: ${b.balanceCents > 0 ? `owes ${formatMoney(b.balanceCents)}` : b.balanceCents < 0 ? `has a ${formatMoney(-b.balanceCents)} credit` : "paid up ($0.00)"}`);
        }
      }
      return out.length ? out.join("\n") : `${tenantDisplayName(matches[0]!)} has no leases you can see.`;
    }
    case "list_delinquent": {
      const today = await orgToday(ctx);
      const r = await runReport(ctx, "delinquency", normalizeParams({}, today), today);
      const rows = r.rows.filter((x) => !x.kind).slice(0, 10);
      if (!rows.length) return "Nobody owes rent right now. 🎉";
      return `${r.highlights.find((h) => h.label === "Tenants owing")?.value} tenants owe ${formatMoney(r.highlights[0]!.value)} in total:\n${rows.map((x) => `- ${x.cells.tenant} (${x.cells.unit}): ${formatMoney(Number(x.cells.balance))}`).join("\n")}`;
    }
    case "list_vacancies": {
      const occ = await occupiedUnitIds(ctx);
      const units = await ctx.db.unit.findMany({ where: { deletedAt: null, property: { deletedAt: null, ...(scope.length ? { id: { in: scope } } : {}) } }, include: { property: { select: { name: true } } }, orderBy: [{ property: { name: "asc" } }, { name: "asc" }] });
      const vacant = units.filter((u) => !occ.has(u.id));
      return vacant.length ? `${vacant.length} vacant of ${units.length} units:\n${vacant.slice(0, 15).map((u) => `- ${u.property.name} · ${u.name} (${formatMoney(u.marketRentCents)}/mo)`).join("\n")}` : "Every unit is occupied.";
    }
    case "list_open_tasks": {
      const tasks = await ctx.db.task.findMany({ where: { status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING"] }, ...(scope.length ? { propertyId: { in: scope } } : {}) }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], take: 10 });
      return tasks.length ? `${tasks.length >= 10 ? "Top 10 open" : `${tasks.length} open`} tasks:\n${tasks.map((t) => `- #${t.number} ${t.title} — ${t.priority.toLowerCase()}, ${t.status.replace("_", " ").toLowerCase()}`).join("\n")}` : "No open tasks.";
    }
    case "report_summary": {
      const key = String(input.report ?? "profit-loss") as "profit-loss";
      const today = await orgToday(ctx);
      const r = await runReport(ctx, key, normalizeParams(reportDefaults(key, today), today), today);
      return `${r.title} (${r.subtitle}):\n${r.highlights.map((h) => `- ${h.label}: ${h.kind === "money" ? formatMoney(h.value) : h.kind === "percent" ? `${(h.value / 100).toFixed(1)}%` : h.value.toLocaleString()}`).join("\n")}`;
    }
    default:
      return "Unknown tool.";
  }
}

async function proposal(ctx: AppContext, id: string, name: string, input: Record<string, unknown>): Promise<{ result: string; proposal?: ProposedAction }> {
  if (name === "create_task") {
    let propertyName = "";
    if (input.propertyName) {
      const p = await ctx.db.property.findFirst({ where: { name: { contains: String(input.propertyName), mode: "insensitive" } } });
      if (p) { input.propertyId = p.id; propertyName = p.name; }
    } else {
      const p = (await ctx.db.property.findMany({ select: { id: true, name: true } })).find((x) => String(input.title ?? "").toLowerCase().includes(x.name.toLowerCase()));
      if (p) { input.propertyId = p.id; propertyName = p.name; }
    }
    const summary = `Create task “${input.title}”${propertyName ? ` at ${propertyName}` : ""}${input.priority && input.priority !== "NORMAL" ? ` (${String(input.priority).toLowerCase()})` : ""}`;
    return { result: `Proposed — waiting for the user to confirm: ${summary}`, proposal: { id, tool: "create_task", input, summary } };
  }
  if (name === "send_message") {
    const matches = await findTenant(ctx, String(input.name ?? ""));
    if (matches.length !== 1) return { result: matches.length ? `Several tenants match “${input.name}”: ${matches.slice(0, 5).map(tenantDisplayName).join(", ")}. Ask which one.` : `No tenant named “${input.name}”.` };
    input.tenantId = matches[0]!.id;
    const summary = `${input.channel === "SMS" ? "Text" : "Portal message"} to ${tenantDisplayName(matches[0]!)}: “${input.body}”`;
    return { result: `Proposed — waiting for the user to confirm: ${summary}`, proposal: { id, tool: "send_message", input, summary } };
  }
  return { result: "Unknown action." };
}

export async function assistantTurn(ctx: AppContext, history: ChatTurn[], message: string): Promise<AssistantReply> {
  if (!message.trim()) throw new UserFacingError("Ask me something");
  const tools = TOOLS.filter((t) => can(ctx.permissions, t.module, t.write ? "edit" : "view"));
  const turns: ChatTurn[] = [...history.slice(-20), { role: "user", content: message.slice(0, 2000) }];
  const proposals: ProposedAction[] = [];
  const used: string[] = [];
  const system = `You are the DeedWood assistant for ${ctx.org.name}, a property management company. Today is ${new Date().toISOString().slice(0, 10)}. Use tools to answer with real data; never invent numbers or names. Writing actions (create_task, send_message) only create a proposal the user confirms — say so. Be brief.`;
  for (let i = 0; i < 4; i++) {
    const r = await getLlmProvider().chat({ system, turns, tools: tools.map(({ write: _w, module: _m, ...t }) => t) });
    turns.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls.length ? r.toolCalls : undefined });
    if (!r.toolCalls.length) {
      await audit(ctx.db, { action: "ai.assistant_turn", entityType: "Assistant", entityId: ctx.user.id, actorType: "AI", after: { tools: used, proposals: proposals.length } });
      return { text: r.text, turns, proposals, toolsUsed: used };
    }
    for (const c of r.toolCalls) {
      const tool = tools.find((t) => t.name === c.name);
      used.push(c.name);
      let content: string;
      if (!tool) content = "You don't have permission to use that.";
      else if (tool.write) {
        const p = await proposal(ctx, c.id, c.name, { ...c.input });
        if (p.proposal) proposals.push(p.proposal);
        content = p.result;
      } else content = await runReadTool(ctx, c.name, c.input);
      turns.push({ role: "tool", toolCallId: c.id, name: c.name, content });
    }
  }
  return { text: "That took too many steps — try a more specific question.", turns, proposals, toolsUsed: used };
}

/** Execute a confirmed proposal with the user's own permissions. */
export async function confirmProposal(ctx: AppContext, p: ProposedAction): Promise<string> {
  if (p.tool === "create_task") {
    if (!can(ctx.permissions, "tasks", "edit")) throw new UserFacingError("You can't create tasks");
    const { createTask } = await import("@/server/maintenance/tasks");
    const t = await createTask(ctx.db, { title: String(p.input.title).slice(0, 200), priority: (["LOW", "NORMAL", "HIGH", "URGENT"].includes(String(p.input.priority)) ? p.input.priority : "NORMAL") as "NORMAL", propertyId: (p.input.propertyId as string) || undefined }, { userId: ctx.user.id, name: ctx.user.name ?? ctx.user.email, kind: "STAFF" });
    await audit(ctx.db, { action: "ai.action_confirmed", entityType: "Task", entityId: t.id, actorType: "AI", after: { tool: p.tool, summary: p.summary } });
    return `Created task #${t.number}.`;
  }
  if (p.tool === "send_message") {
    if (!can(ctx.permissions, "communications", "edit")) throw new UserFacingError("You can't send messages");
    const { findOrCreateConversation, sendMessage } = await import("@/server/comms/service");
    const conv = await findOrCreateConversation(ctx.db, { tenantId: String(p.input.tenantId) });
    await sendMessage(ctx.db, conv.id, { body: String(p.input.body).slice(0, 2000), channel: p.input.channel === "SMS" ? "SMS" : "PORTAL", author: { userId: ctx.user.id, name: ctx.user.name ?? ctx.user.email }, aiDrafted: true });
    await audit(ctx.db, { action: "ai.action_confirmed", entityType: "Conversation", entityId: conv.id, actorType: "AI", after: { tool: p.tool, summary: p.summary } });
    return "Message sent.";
  }
  throw new UserFacingError("Unknown action");
}
