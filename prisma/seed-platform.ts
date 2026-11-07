import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { createScopedClient } from "../src/server/dal";
import { saveWebhookEndpoint } from "../src/server/platform/events";
import { saveWorkflow } from "../src/server/platform/workflows";
import { runAgents, saveAgentConfig } from "../src/server/ai/agents";

/** A fixed, local-only demo key so the API can be tried right after seeding. */
export const DEMO_API_KEY = "hs_live_00dea100_localDemoKeyDoNotUseInProduction";

/** Phase 10 demo data: demo API key, a webhook endpoint (dev sink), two workflows, agents with proposals. */
export async function seedPlatform(appUrl: string, orgId: string, users: Record<string, string>) {
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const admin = users["admin@example.com"]!;
  const db = createScopedClient(app, { orgId, userId: admin });
  await db.apiKey.create({ data: { organizationId: orgId, name: "Demo key (local only)", prefix: "hs_live_00dea100", secretHash: createHash("sha256").update(DEMO_API_KEY).digest("hex"), scope: "write", environment: "live", createdById: admin } });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  await saveWebhookEndpoint(db, null, { url: `${base}/api/dev/webhook-sink`, description: "Local test receiver (verifies signatures)", events: ["task.created", "payment.succeeded", "application.submitted"], active: true });
  await saveWorkflow(db, null, { name: "Urgent tenant request → alert the property manager", trigger: "task.created", conditions: [{ field: "type", op: "eq", value: "TENANT_REQUEST" }, { field: "priority", op: "eq", value: "URGENT" }], actions: [{ type: "NOTIFY_STAFF", params: { userId: users["pm@example.com"]!, subject: "URGENT request #{{number}}: {{title}}", body: "A tenant just reported: {{title}}. Open Tasks to dispatch a vendor." } }], active: true });
  await saveWorkflow(db, null, { name: "Failed payment → follow-up task + tenant email", trigger: "payment.failed", conditions: [], actions: [{ type: "CREATE_TASK", params: { title: "Follow up on failed payment ({{amountCents}})", priority: "HIGH" } }, { type: "SEND_EMAIL", params: { subject: "Your rent payment didn't go through", body: "Hi, your payment of {{amountCents}} failed ({{failureReason}}). Please pay again in the resident portal." } }], active: true });
  await saveAgentConfig(db, "RECEPTIONIST", { enabled: true, mode: "APPROVAL", threshold: 85 });
  await saveAgentConfig(db, "MAINTENANCE", { enabled: true, mode: "APPROVAL", threshold: 85 });
  await saveAgentConfig(db, "RENEWALS", { enabled: false, mode: "APPROVAL", threshold: 85, settings: { maxAutoIncreasePct: 5 } });
  const proposed = await runAgents(db);
  await app.$disconnect();
  return { proposed };
}
