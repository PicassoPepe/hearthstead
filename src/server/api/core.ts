import "server-only";
import { flagEnabled } from "@/server/platform-admin/flags";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import IORedis from "ioredis";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";

/**
 * Public API plumbing: bearer API keys (hashed), live/test (sandbox) environments, per-key rate
 * limiting, cursor pagination, idempotency keys for POST, and uniform JSON errors.
 */
export type ApiContext = { db: ScopedDb; orgId: string; keyId: string; scope: "read" | "write"; environment: "live" | "test" };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly type: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export const hashSecret = (s: string) => createHash("sha256").update(s).digest("hex");

/** New key: `dw_live_<prefix>_<secret>`; only the prefix and a hash of the full key are stored. */
export function generateApiKey(environment: "live" | "test") {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `dw_${environment}_${prefix}_${secret}`;
  return { key, prefix: `dw_${environment}_${prefix}`, secretHash: hashSecret(key) };
}

export async function authenticate(req: Request): Promise<ApiContext> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(dw_(live|test)_[a-f0-9]{8}_[A-Za-z0-9_-]+)$/);
  if (!m) throw new ApiError(401, "authentication_error", "Provide an API key: Authorization: Bearer dw_live_…");
  const key = await adminDb.apiKey.findUnique({ where: { secretHash: hashSecret(m[1]!) } });
  if (!key || key.revokedAt) throw new ApiError(401, "authentication_error", "Invalid or revoked API key");
  if (!(await flagEnabled("api", key.organizationId))) throw new ApiError(403, "permission_error", "The API is turned off for this account. Contact DeedWood support.");
  let orgId = key.organizationId;
  if (key.environment === "test") {
    const org = await adminDb.organization.findUnique({ where: { id: key.organizationId }, select: { sandboxOrgId: true } });
    if (!org?.sandboxOrgId) throw new ApiError(400, "invalid_request_error", "This organization has no sandbox yet. Create one in Settings → Integrations.");
    orgId = org.sandboxOrgId;
  }
  // Last-used is informational; don't write on every request.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await adminDb.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { db: forOrg({ orgId, userId: null }), orgId, keyId: key.id, scope: key.scope as "read" | "write", environment: key.environment as "live" | "test" };
}

// ---------------------------------------------------------------- rate limiting

const LIMIT = Number(process.env.API_RATE_LIMIT ?? 120); // requests per minute per key
let redis: IORedis | null | undefined;
const memory = new Map<string, { n: number; reset: number }>();

function getRedis() {
  if (redis !== undefined) return redis;
  try {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
    redis.on("error", () => undefined);
    void redis.connect().catch(() => { redis = null; });
  } catch {
    redis = null;
  }
  return redis;
}

/** Fixed one-minute window; Redis when available (shared across instances), memory otherwise. */
export async function rateLimit(keyId: string): Promise<{ limit: number; remaining: number; reset: number }> {
  const window = Math.floor(Date.now() / 60_000);
  const reset = (window + 1) * 60;
  let n: number;
  const r = getRedis();
  try {
    if (!r || r.status !== "ready") throw new Error("no redis");
    const k = `rl:${keyId}:${window}`;
    n = await r.incr(k);
    if (n === 1) await r.expire(k, 70);
  } catch {
    const k = `${keyId}:${window}`;
    const cur = memory.get(k) ?? { n: 0, reset };
    cur.n++;
    memory.set(k, cur);
    n = cur.n;
    if (memory.size > 10_000) for (const [mk, v] of memory) if (v.reset * 1000 < Date.now()) memory.delete(mk);
  }
  const out = { limit: LIMIT, remaining: Math.max(0, LIMIT - n), reset };
  if (n > LIMIT) throw new ApiError(429, "rate_limit_error", `Too many requests — ${LIMIT} per minute per key. Retry after the reset time.`, out);
  return out;
}

// ---------------------------------------------------------------- pagination

export const encodeCursor = (id: string) => Buffer.from(id).toString("base64url");
export const decodeCursor = (c: string | null) => {
  if (!c) return null;
  try {
    return Buffer.from(c, "base64url").toString();
  } catch {
    throw new ApiError(400, "invalid_request_error", "Invalid cursor");
  }
};

export function pageParams(url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25));
  const after = decodeCursor(url.searchParams.get("cursor"));
  return { take: limit + 1, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: "asc" as const }, limit };
}

export function page<T extends { id: string }>(rows: T[], limit: number, map: (r: T) => unknown) {
  const more = rows.length > limit;
  const data = rows.slice(0, limit);
  return { object: "list", data: data.map(map), has_more: more, next_cursor: more ? encodeCursor(data.at(-1)!.id) : null };
}

// ---------------------------------------------------------------- handler wrapper

type Handler = (ctx: ApiContext, req: Request, params: { id: string } & Record<string, string>) => Promise<{ status?: number; body: unknown }>;

/** Wrap a route: auth, scope, rate limit, idempotency (POST/PATCH), and error shaping. */
export function apiRoute(opts: { write?: boolean }, handler: Handler) {
  return async (req: Request, routeCtx: { params: Promise<Record<string, string>> }) => {
    let rl: { limit: number; remaining: number; reset: number } | undefined;
    try {
      const ctx = await authenticate(req);
      rl = await rateLimit(ctx.keyId);
      if (opts.write && ctx.scope !== "write") throw new ApiError(403, "permission_error", "This API key is read-only");
      const params = (await routeCtx.params) as { id: string } & Record<string, string>;
      const idemKey = opts.write ? req.headers.get("idempotency-key") : null;
      if (idemKey) {
        if (idemKey.length > 255) throw new ApiError(400, "invalid_request_error", "Idempotency-Key is too long");
        const body = await req.clone().text();
        const reqHash = hashSecret(`${req.method} ${new URL(req.url).pathname} ${body}`);
        const prior = await adminDb.idempotencyRecord.findUnique({ where: { apiKeyId_key: { apiKeyId: ctx.keyId, key: idemKey } } });
        if (prior && Date.now() - prior.createdAt.getTime() < 86_400_000) {
          if (prior.requestHash !== reqHash) throw new ApiError(409, "idempotency_error", "This Idempotency-Key was used with a different request");
          return json(prior.response, prior.statusCode, rl, { "idempotent-replayed": "true" });
        }
        const r = await handler(ctx, req, params);
        const status = r.status ?? 200;
        if (status < 500) {
          await adminDb.idempotencyRecord.upsert({
            where: { apiKeyId_key: { apiKeyId: ctx.keyId, key: idemKey } },
            create: { organizationId: ctx.orgId, apiKeyId: ctx.keyId, key: idemKey, requestHash: reqHash, statusCode: status, response: r.body as object },
            update: { requestHash: reqHash, statusCode: status, response: r.body as object, createdAt: new Date() },
          });
        }
        return json(r.body, status, rl);
      }
      const r = await handler(ctx, req, params);
      return json(r.body, r.status ?? 200, rl);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: { type: e.type, message: e.message, ...(e.details && e.status !== 429 ? { details: e.details } : {}) } }, e.status, rl ?? (e.status === 429 ? (e.details as typeof rl) : undefined));
      if (e instanceof ZodError) return json({ error: { type: "invalid_request_error", message: "Invalid request body", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, 400, rl);
      if (e instanceof UserFacingError) return json({ error: { type: "invalid_request_error", message: e.message, ...(e.fieldErrors ? { details: e.fieldErrors } : {}) } }, 400, rl);
      console.error("[api]", e);
      void import("@/server/ops/errors").then((m) => m.recordError("api", e, { path: new URL(req.url).pathname })).catch(() => undefined);
      return json({ error: { type: "api_error", message: "Something went wrong on our side." } }, 500, rl);
    }
  };
}

function json(body: unknown, status: number, rl?: { limit: number; remaining: number; reset: number }, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { "cache-control": "no-store", ...extra };
  if (rl) Object.assign(h, { "x-ratelimit-limit": String(rl.limit), "x-ratelimit-remaining": String(rl.remaining), "x-ratelimit-reset": String(rl.reset) });
  if (status === 429 && rl) h["retry-after"] = String(Math.max(1, rl.reset - Math.floor(Date.now() / 1000)));
  return NextResponse.json(body, { status, headers: h });
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_request_error", "Request body must be JSON");
  }
  return schema.parse(raw);
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
