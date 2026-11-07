import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";

/**
 * Domain events. `emit` fans an event out to webhook endpoints (signed, retried with backoff) and
 * to workflows. It never throws into the business action that raised it.
 */
export const EVENT_TYPES = ["lease.created", "lease.ended", "payment.succeeded", "payment.failed", "task.created", "task.updated", "application.submitted"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_LABEL: Record<EventType, string> = {
  "lease.created": "Lease created", "lease.ended": "Lease ended", "payment.succeeded": "Payment succeeded", "payment.failed": "Payment failed",
  "task.created": "Task created", "task.updated": "Task updated", "application.submitted": "Application submitted",
};

export type DomainEvent = { id: string; type: EventType; createdAt: string; organizationId: string; data: Record<string, unknown> };

/** Retry schedule after a failed attempt: 1m, 5m, 30m, 2h, 12h, then give up. */
export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 720];

export async function emit(db: ScopedDb, type: EventType, data: Record<string, unknown>): Promise<DomainEvent> {
  const event: DomainEvent = { id: `evt_${randomUUID().replace(/-/g, "")}`, type, createdAt: new Date().toISOString(), organizationId: db.ctx.orgId, data };
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { active: true, deletedAt: null, events: { has: type } } });
    if (endpoints.length) {
      await db.webhookDelivery.createMany({ data: endpoints.map((e) => ({ organizationId: db.ctx.orgId, endpointId: e.id, eventId: event.id, event: type, payload: event as unknown as object })) });
      // First attempt right away, without blocking the caller.
      void deliverDue(db, event.id).catch(() => undefined);
    }
    const { runWorkflowsFor } = await import("./workflows");
    await runWorkflowsFor(db, event);
  } catch (e) {
    console.error("[events] emit failed", type, e);
  }
  return event;
}

/** Stripe-style signature: header `Hearthstead-Signature: t=<unix>,v1=<hex HMAC-SHA256(t + "." + body)>`. */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  return signPayload(secret, body, t) === header;
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number; ok: boolean }>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
/** Tests swap the HTTP client. */
export function setWebhookFetcher(f: Fetcher) { fetcher = f; }

/** Attempt every due delivery (optionally only one event's). Called inline and by the minutely worker. */
export async function deliverDue(db: ScopedDb, eventId?: string, now = new Date()) {
  const due = await db.webhookDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now }, ...(eventId ? { eventId } : {}) }, include: { endpoint: true }, take: 100 });
  let ok = 0;
  for (const d of due) {
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const url = new URL(d.endpoint.url);
      if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Webhook URLs must use https");
      const res = await fetcher(d.endpoint.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Hearthstead-Webhooks/1.0", "hearthstead-event": d.event, "hearthstead-delivery": d.id, "hearthstead-signature": signPayload(d.endpoint.secret, body) }, body });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : "Request failed";
    }
    const attempts = d.attempts + 1;
    if (!error) {
      ok++;
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCEEDED", attempts, responseStatus: status, lastError: null, deliveredAt: new Date() } });
    } else {
      const delay = RETRY_DELAYS_MIN[attempts - 1];
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: delay ? "FAILED" : "DEAD", attempts, responseStatus: status, lastError: error.slice(0, 300), nextAttemptAt: new Date(now.getTime() + (delay ?? 0) * 60_000) } });
    }
  }
  return { attempted: due.length, succeeded: ok };
}

export async function saveWebhookEndpoint(db: ScopedDb, id: string | null, v: { url: string; description?: string; events: string[]; active: boolean }) {
  let u: URL;
  try { u = new URL(v.url); } catch { throw new UserFacingError("Enter a full URL, like https://example.com/hooks", { url: "Invalid URL" }); }
  if (!["https:", "http:"].includes(u.protocol)) throw new UserFacingError("Use an https URL", { url: "https only" });
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") throw new UserFacingError("Use an https URL", { url: "https only" });
  const events = v.events.filter((e): e is EventType => (EVENT_TYPES as readonly string[]).includes(e));
  if (!events.length) throw new UserFacingError("Choose at least one event", { events: "Choose events" });
  const data = { url: v.url, description: v.description || null, events, active: v.active };
  const e = id ? await db.webhookEndpoint.update({ where: { id }, data }) : await db.webhookEndpoint.create({ data: { organizationId: db.ctx.orgId, secret: newWebhookSecret(), createdById: db.ctx.userId, ...data } });
  await audit(db, { action: id ? "webhook.updated" : "webhook.created", entityType: "WebhookEndpoint", entityId: e.id, after: data });
  return e;
}

export async function retryDelivery(db: ScopedDb, id: string) {
  const d = await db.webhookDelivery.findFirst({ where: { id } });
  if (!d) throw new UserFacingError("Delivery not found");
  await db.webhookDelivery.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date() } });
  return deliverDue(db, d.eventId);
}

/** Send a signed ping to one endpoint (status shows up in its delivery log). */
export async function sendTestEvent(db: ScopedDb, endpointId: string) {
  const e = await db.webhookEndpoint.findFirst({ where: { id: endpointId } });
  if (!e) throw new UserFacingError("Endpoint not found");
  const event: DomainEvent = { id: `evt_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`, type: (e.events[0] as EventType) ?? "task.created", createdAt: new Date().toISOString(), organizationId: db.ctx.orgId, data: { test: true, message: "This is a test event from Hearthstead." } };
  await db.webhookDelivery.create({ data: { organizationId: db.ctx.orgId, endpointId: e.id, eventId: event.id, event: event.type, payload: event as unknown as object } });
  return deliverDue(db, event.id);
}
