"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext, requirePermission } from "@/server/context";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";
import * as I from "@/server/platform/integrations";
import * as EV from "@/server/platform/events";
import * as W from "@/server/platform/workflows";
import * as AG from "@/server/ai/agents";
import * as AS from "@/server/ai/assistant";
import { newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "@/server/platform/totp";
import type { ChatTurn } from "@/adapters/llm";

/** Phase 10 staff actions. Integrations need settings:edit; workflows need workflows:edit; the assistant needs ai:view. */
const done = (p: string) => revalidatePath(p, "layout");

// ---------------------------------------------------------------- API keys & sandbox

export async function createApiKeyAction(raw: { name: string; scope: "read" | "write"; environment: "live" | "test" }): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const v = z.object({ name: z.string().max(60), scope: z.enum(["read", "write"]), environment: z.enum(["live", "test"]) }).parse(raw);
    const r = await I.createApiKey(ctx.db, v);
    done("/app/settings/integrations");
    return { key: r.key };
  });
}

export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    await I.revokeApiKey(ctx.db, id);
    done("/app/settings/integrations");
  }, "API key revoked");
}

export async function sandboxAction(reset: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    await I.ensureSandbox(ctx.db, reset);
    done("/app/settings/integrations");
  }, reset ? "Sandbox reset with fresh sample data" : "Sandbox created");
}

// ---------------------------------------------------------------- webhooks

export async function saveWebhookAction(id: string | null, raw: { url: string; description?: string; events: string[]; active: boolean }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const e = await EV.saveWebhookEndpoint(ctx.db, id, raw);
    done("/app/settings/integrations");
    return { id: e.id };
  }, "Webhook endpoint saved");
}

export async function deleteWebhookAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    await ctx.db.webhookEndpoint.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await audit(ctx.db, { action: "webhook.deleted", entityType: "WebhookEndpoint", entityId: id });
    done("/app/settings/integrations");
  }, "Webhook endpoint deleted");
}

export async function testWebhookAction(id: string): Promise<ActionResult<{ attempted: number; succeeded: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const r = await EV.sendTestEvent(ctx.db, id);
    done("/app/settings/integrations");
    return r;
  });
}

export async function retryDeliveryAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    await EV.retryDelivery(ctx.db, id);
    done("/app/settings/integrations");
  }, "Retried");
}

export async function revealWebhookSecretAction(id: string): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const e = await ctx.db.webhookEndpoint.findFirst({ where: { id } });
    if (!e) throw new UserFacingError("Not found");
    await audit(ctx.db, { action: "webhook.secret_revealed", entityType: "WebhookEndpoint", entityId: id });
    return e.secret;
  });
}

// ---------------------------------------------------------------- workflows

export async function saveWorkflowAction(id: string | null, raw: W.WorkflowInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("workflows", "edit");
    const w = await W.saveWorkflow(ctx.db, id, raw);
    done("/app/workflows");
    return { id: w.id };
  }, "Workflow saved");
}

export async function toggleWorkflowAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("workflows", "edit");
    await ctx.db.workflow.updateMany({ where: { id }, data: { active } });
    done("/app/workflows");
  }, active ? "Workflow turned on" : "Workflow paused");
}

export async function deleteWorkflowAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("workflows", "delete");
    await ctx.db.workflow.updateMany({ where: { id }, data: { deletedAt: new Date(), active: false } });
    done("/app/workflows");
  }, "Workflow deleted");
}

// ---------------------------------------------------------------- AI

export async function assistantAction(history: ChatTurn[], message: string): Promise<ActionResult<AS.AssistantReply>> {
  return runAction(async () => {
    const ctx = await requirePermission("ai", "view");
    return AS.assistantTurn(ctx, history, message);
  });
}

export async function confirmProposalAction(p: AS.ProposedAction): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("ai", "view");
    return AS.confirmProposal(ctx, p);
  });
}

export async function saveAgentAction(agent: AG.AgentKey, raw: { enabled: boolean; mode: "AUTO" | "APPROVAL"; threshold: number; maxAutoIncreasePct?: number }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("ai", "edit");
    await AG.saveAgentConfig(ctx.db, agent, { enabled: raw.enabled, mode: raw.mode, threshold: raw.threshold, settings: raw.maxAutoIncreasePct !== undefined ? { maxAutoIncreasePct: raw.maxAutoIncreasePct } : {} });
    done("/app/ai");
  }, "Agent settings saved");
}

export async function runAgentsNowAction(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const ctx = await requirePermission("ai", "edit");
    const n = await AG.runAgents(ctx.db);
    done("/app/ai");
    return n;
  });
}

export async function decideAgentActionAction(id: string, approve: boolean): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("ai", "edit");
    const r = approve ? await AG.execute(ctx.db, id, ctx.user.id) : (await AG.reject(ctx.db, id, ctx.user.id), "Rejected");
    done("/app/ai");
    return r;
  });
}

// ---------------------------------------------------------------- security

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function start2faAction(): Promise<ActionResult<{ secret: string; uri: string }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const u = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (u.twoFactorEnabled) throw new UserFacingError("Two-factor is already on");
    const secret = newTotpSecret();
    await adminDb.user.update({ where: { id: u.id }, data: { totpSecret: secret } });
    return { secret, uri: otpauthUri(secret, u.email) };
  });
}

export async function confirm2faAction(code: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const u = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!u.totpSecret || u.twoFactorEnabled) throw new UserFacingError("Start setup first");
    if (!verifyTotp(u.totpSecret, code)) throw new UserFacingError("That code didn't match — check your device's time and try the newest code", { code: "Invalid code" });
    const codes = newRecoveryCodes();
    await adminDb.user.update({ where: { id: u.id }, data: { twoFactorEnabled: true, recoveryCodeHashes: codes.map((c) => sha(c)) } });
    await audit(ctx.db, { action: "user.2fa_enabled", entityType: "User", entityId: u.id });
    return { recoveryCodes: codes };
  });
}

export async function disable2faAction(code: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext();
    const u = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!u.twoFactorEnabled || !u.totpSecret) throw new UserFacingError("Two-factor is off");
    if (!verifyTotp(u.totpSecret, code) && !u.recoveryCodeHashes.includes(sha(code.trim().toLowerCase()))) throw new UserFacingError("Enter a current code to turn two-factor off", { code: "Invalid code" });
    await adminDb.user.update({ where: { id: u.id }, data: { twoFactorEnabled: false, totpSecret: null, recoveryCodeHashes: [] } });
    await audit(ctx.db, { action: "user.2fa_disabled", entityType: "User", entityId: u.id });
    done("/app/settings/security");
  }, "Two-factor authentication turned off");
}

export async function revokeSessionAction(id: string | "others"): Promise<ActionResult<number>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const session = (await auth()) as { sid?: string } | null;
    const where = id === "others" ? { userId: ctx.user.id, revokedAt: null, id: { not: session?.sid ?? "" } } : { id, userId: ctx.user.id, revokedAt: null };
    const r = await adminDb.userSession.updateMany({ where, data: { revokedAt: new Date() } });
    await audit(ctx.db, { action: "user.sessions_revoked", entityType: "User", entityId: ctx.user.id, after: { count: r.count } });
    done("/app/settings/security");
    return r.count;
  });
}

export async function setSupportAccessAction(on: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const until = on ? new Date(Date.now() + 30 * 86_400_000) : null;
    await adminDb.organization.update({ where: { id: ctx.org.id }, data: { supportAccessUntil: until } });
    await audit(ctx.db, { action: on ? "org.support_access_granted" : "org.support_access_revoked", entityType: "Organization", entityId: ctx.org.id, after: { until } });
    done("/app/settings/security");
  }, on ? "Support access granted for 30 days" : "Support access turned off");
}
