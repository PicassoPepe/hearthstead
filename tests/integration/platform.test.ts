import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import { createTask, setTaskStatus } from "@/server/maintenance/tasks";
import * as EV from "@/server/platform/events";
import * as W from "@/server/platform/workflows";
import * as I from "@/server/platform/integrations";
import * as AG from "@/server/ai/agents";
import * as AS from "@/server/ai/assistant";
import { receivePortalMessage } from "@/server/comms/service";
import { openApiDocument } from "@/server/api/openapi";
import { BUILT_IN_ROLES } from "@/server/permissions";
import type { AppContext } from "@/server/context";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let db: ScopedDb;
let ctx: AppContext;
let propertyId: string;
let tenantId: string;
const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
let respond = 200;

beforeAll(async () => {
  O = await makeOrg("PL");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  ctx = { db, org: { id: O.orgId, name: "Test PL" }, user: { id: O.userId, email: "pl@test.local", name: "Pat", preferences: {} }, membership: { propertyScope: [], roleKey: "ADMIN" }, permissions: BUILT_IN_ROLES.ADMIN.permissions } as unknown as AppContext;
  EV.setWebhookFetcher(async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return { status: respond, ok: respond < 300 };
  });
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Platform Place", address: { addressLine1: "1 API Way", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 100_000 }, { name: "2", marketRentCents: 100_000 }], owners: [] })).id;
});
afterAll(async () => {
  const org = await admin.organization.findUnique({ where: { id: O.orgId } });
  await cleanup([O.orgId, ...(org?.sandboxOrgId ? [org.sandboxOrgId] : [])], [O.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("webhooks", () => {
  it("signs, delivers, retries with backoff, then gives up", async () => {
    const ep = await EV.saveWebhookEndpoint(db, null, { url: "https://hooks.example.com/hs", events: ["task.created"], active: true });
    await expect(EV.saveWebhookEndpoint(db, null, { url: "ftp://x", events: ["task.created"], active: true })).rejects.toThrow(/https/);
    await createTask(db, { title: "Hook me", propertyId }, { userId: O.userId, name: "Pat", kind: "STAFF" });
    await new Promise((r) => setTimeout(r, 50));
    await EV.deliverDue(db);
    const del = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });
    expect(del.status).toBe("SUCCEEDED");
    const call = calls.find((c) => c.url === "https://hooks.example.com/hs")!;
    expect(EV.verifySignature(ep.secret, call.body, call.headers["deedwood-signature"]!)).toBe(true);
    expect(EV.verifySignature("whsec_wrong", call.body, call.headers["deedwood-signature"]!)).toBe(false);
    expect(JSON.parse(call.body)).toMatchObject({ type: "task.created", data: { title: "Hook me" } });

    respond = 500;
    await createTask(db, { title: "Will fail", propertyId }, { userId: O.userId, name: "Pat", kind: "STAFF" });
    await new Promise((r) => setTimeout(r, 50));
    const failing = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id, payload: { path: ["data", "title"], equals: "Will fail" } } });
    let now = new Date();
    for (let i = 0; i < 6; i++) {
      await EV.deliverDue(db, failing.eventId, now);
      now = new Date(now.getTime() + 13 * 3_600_000);
    }
    const dead = await db.webhookDelivery.findFirstOrThrow({ where: { id: failing.id } });
    expect(dead.status).toBe("DEAD");
    expect(dead.attempts).toBe(EV.RETRY_DELAYS_MIN.length + 1);
    respond = 200;
  });
});

describe("workflows", () => {
  it("runs matching workflows once, skips when conditions fail, and never loops", async () => {
    const tenant = await db.tenant.create({ data: { organizationId: O.orgId, firstName: "Wren", lastName: "Flow", email: `wren-${Date.now()}@example.com` } });
    tenantId = tenant.id;
    await W.saveWorkflow(db, null, { name: "Urgent request → task + email", trigger: "task.created", conditions: [{ field: "priority", op: "eq", value: "URGENT" }], actions: [{ type: "CREATE_TASK", params: { title: "Call tenant about #{{number}}", priority: "HIGH" } }, { type: "SEND_EMAIL", params: { subject: "We got your request #{{number}}", body: "Hi! {{title}} is in our queue." } }], active: true });
    await expect(W.saveWorkflow(db, null, { name: "Bad", trigger: "task.created", conditions: [{ field: "nope", op: "eq", value: "x" }], actions: [{ type: "CREATE_TASK", params: { title: "x" } }], active: true })).rejects.toThrow(/isn't available/);
    await createTask(db, { title: "Normal thing", propertyId, priority: "NORMAL", tenantId }, { userId: O.userId, name: "Pat", kind: "STAFF" });
    await createTask(db, { title: "Flooding in basement", propertyId, priority: "URGENT", tenantId }, { userId: O.userId, name: "Pat", kind: "STAFF" });
    const runs = await db.workflowRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs.map((r) => r.status)).toEqual(["SKIPPED", "SUCCEEDED"]);
    expect(await db.task.count({ where: { title: { startsWith: "Call tenant about #" } } })).toBe(1); // created by the workflow, didn't re-trigger
    const mail = await admin.emailMessage.findFirst({ where: { to: tenant.email!, subject: { startsWith: "We got your request #" } } });
    expect(mail?.text).toMatch(/Flooding in basement is in our queue/);
  });

  it("condition helper handles money and text", () => {
    expect(W.conditionMet({ amountCents: 150_000 }, { field: "amountCents", op: "gt", value: "1000" })).toBe(true);
    expect(W.conditionMet({ category: "Plumbing" }, { field: "category", op: "contains", value: "plumb" })).toBe(true);
    expect(W.fill("Paid {{amountCents}} by {{method}}", { amountCents: 12_345, method: "CARD" })).toBe("Paid $123.45 by CARD");
  });
});

describe("API keys, sandbox, OpenAPI, export", () => {
  it("test keys need a sandbox; the sandbox is a separate org with sample data", async () => {
    await expect(I.createApiKey(db, { name: "Test", scope: "read", environment: "test" })).rejects.toThrow(/sandbox/);
    const sandboxId = await I.ensureSandbox(db);
    const sdb = createScopedClient(app, { orgId: sandboxId, userId: null });
    expect(await sdb.property.count()).toBe(2);
    expect(await sdb.lease.count()).toBe(2);
    expect((await admin.organization.findUniqueOrThrow({ where: { id: sandboxId } })).isSandbox).toBe(true);
    const live = await I.createApiKey(db, { name: "Zapier", scope: "write", environment: "live" });
    expect(live.key).toMatch(/^dw_live_[a-f0-9]{8}_/);
    const row = await db.apiKey.findFirstOrThrow({ where: { id: live.id } });
    expect(row.secretHash).not.toContain(live.key.slice(-10));
  });

  it("OpenAPI 3.1 document lists every endpoint with schemas", () => {
    const doc = openApiDocument("http://localhost:3000") as { openapi: string; paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/properties", "/leases/{id}/balance", "/tasks/{id}"]));
    expect(doc.components.schemas).toHaveProperty("Lease");
    expect(doc.components.schemas).toHaveProperty("CreateTask");
  });

  it("journal export (CSV) balances", async () => {
    const r = await I.exportJournal(db, "2020-01-01", "2030-12-31", "csv");
    expect(r.body.split("\n")[0]).toContain("Journal No");
    expect(r.summary.debitCents).toBe(r.summary.creditCents);
  });
});

describe("AI", () => {
  it("assistant answers with tools and turns writes into proposals that need confirmation", async () => {
    const unit = (await db.unit.findFirstOrThrow({ where: { propertyId, name: "1" } })).id;
    const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    await createLease(db, { propertyId, unitIds: [unit], termType: "FIXED", startDate: "2026-10-01", endDate: "2027-01-31", rentDueDay: 1, tenants: [{ tenantId, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 100_000 }], deposit: { amountCents: 0, handling: "NONE" } }, d("2026-11-07"));
    const r1 = await AS.assistantTurn(ctx, [], "What's the balance for Wren Flow?");
    expect(r1.toolsUsed).toEqual(["get_tenant_balance"]);
    expect(r1.text).toMatch(/Wren Flow — Platform Place 1: owes \$2,000\.00/);
    const r2 = await AS.assistantTurn(ctx, r1.turns, "Create a task to replace the lobby light at Platform Place");
    expect(r2.proposals).toHaveLength(1);
    const before = await db.task.count();
    expect(await db.task.count()).toBe(before);
    expect(await AS.confirmProposal(ctx, r2.proposals[0]!)).toMatch(/Created task #/);
    expect(await db.task.count()).toBe(before + 1);
    expect(await db.auditLog.count({ where: { action: "ai.action_confirmed" } })).toBe(1);
  });

  it("agents propose (approval mode) or act (auto mode above threshold), once per item", async () => {
    await receivePortalMessage(db, { tenantId }, "How do I set up autopay for rent?", { userId: null, name: "Wren Flow" });
    await AG.saveAgentConfig(db, "RECEPTIONIST", { enabled: true, mode: "APPROVAL", threshold: 80 });
    expect(await AG.runAgents(db)).toBe(1);
    expect(await AG.runAgents(db)).toBe(0);
    const a = await db.agentAction.findFirstOrThrow({ where: { agent: "RECEPTIONIST" } });
    expect(a).toMatchObject({ status: "PROPOSED", confidence: 90 });
    expect(await AG.execute(db, a.id, O.userId)).toBe("Reply sent");

    await createTask(db, { type: "TENANT_REQUEST", title: "Kitchen sink is leaking", propertyId, tenantId }, { userId: null, name: "Wren", kind: "TENANT" });
    await db.vendor.create({ data: { organizationId: O.orgId, name: "Pipe Pros", trades: ["PLUMBING"] } });
    await AG.saveAgentConfig(db, "MAINTENANCE", { enabled: true, mode: "AUTO", threshold: 80 });
    await AG.runAgents(db);
    const triaged = await db.agentAction.findFirstOrThrow({ where: { agent: "MAINTENANCE" } });
    expect(triaged.status).toBe("EXECUTED");
    const t = await db.task.findFirstOrThrow({ where: { title: "Kitchen sink is leaking" }, include: { vendor: true } });
    expect(t.category).toBe("PLUMBING");
    expect(t.vendor?.name).toBe("Pipe Pros");
  });

  it("status change events reach webhooks for task.updated", async () => {
    const ep = await EV.saveWebhookEndpoint(db, null, { url: "https://hooks.example.com/updates", events: ["task.updated"], active: true });
    const t = await db.task.findFirstOrThrow({ where: { title: "Kitchen sink is leaking" } });
    await setTaskStatus(db, t.id, "IN_PROGRESS", { userId: O.userId, name: "Pat", kind: "STAFF" });
    await new Promise((r) => setTimeout(r, 50));
    await EV.deliverDue(db);
    expect(await db.webhookDelivery.count({ where: { endpointId: ep.id, status: "SUCCEEDED" } })).toBeGreaterThanOrEqual(1);
  });
});
