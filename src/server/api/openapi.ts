import { z } from "zod";
import * as S from "./schemas";

/** OpenAPI 3.1 document generated from the same Zod schemas the routes validate with. */
type Op = { method: "get" | "post" | "patch"; path: string; summary: string; tag: string; write?: boolean; body?: z.ZodType; response: z.ZodType; status?: number; params?: string[]; list?: boolean; idempotent?: boolean };

const OPS: Op[] = [
  { method: "get", path: "/properties", summary: "List properties", tag: "Rentals", response: S.list(S.Property, "Property"), list: true },
  { method: "get", path: "/properties/{id}", summary: "Retrieve a property", tag: "Rentals", response: S.Property, params: ["id"] },
  { method: "get", path: "/units", summary: "List units (filter with ?property_id=)", tag: "Rentals", response: S.list(S.Unit, "Unit"), list: true },
  { method: "get", path: "/tenants", summary: "List tenants", tag: "People", response: S.list(S.Tenant, "Tenant"), list: true },
  { method: "post", path: "/tenants", summary: "Create a tenant", tag: "People", write: true, body: S.CreateTenant, response: S.Tenant, status: 201, idempotent: true },
  { method: "get", path: "/leases", summary: "List leases (filter with ?status=ACTIVE)", tag: "Leasing", response: S.list(S.Lease, "Lease"), list: true },
  { method: "get", path: "/leases/{id}", summary: "Retrieve a lease", tag: "Leasing", response: S.Lease, params: ["id"] },
  { method: "get", path: "/leases/{id}/balance", summary: "Lease balance (from the ledger)", tag: "Leasing", response: S.Balance, params: ["id"] },
  { method: "get", path: "/leases/{id}/transactions", summary: "Lease ledger transactions", tag: "Leasing", response: S.list(S.Transaction, "Transaction"), params: ["id"], list: true },
  { method: "post", path: "/leases/{id}/charges", summary: "Post a charge to a lease", tag: "Leasing", write: true, body: S.CreateCharge, response: S.Transaction, status: 201, params: ["id"], idempotent: true },
  { method: "get", path: "/tasks", summary: "List tasks (filter with ?status=)", tag: "Maintenance", response: S.list(S.Task, "Task"), list: true },
  { method: "post", path: "/tasks", summary: "Create a task or work order", tag: "Maintenance", write: true, body: S.CreateTask, response: S.Task, status: 201, idempotent: true },
  { method: "get", path: "/tasks/{id}", summary: "Retrieve a task", tag: "Maintenance", response: S.Task, params: ["id"] },
  { method: "patch", path: "/tasks/{id}", summary: "Update a task's status, priority or title", tag: "Maintenance", write: true, body: S.UpdateTask, response: S.Task, params: ["id"], idempotent: true },
];

const ref = (s: z.ZodType) => {
  const id = (z.globalRegistry.get(s) as { id?: string } | undefined)?.id;
  return id ? { $ref: `#/components/schemas/${id}` } : z.toJSONSchema(s, { target: "draft-2020-12", io: "output" });
};

export function openApiDocument(baseUrl: string) {
  // Every schema registered with .meta({ id }) becomes a component; refs between them are preserved.
  for (const o of OPS) void o.response; // ensure list schemas are registered
  const generated = z.toJSONSchema(z.globalRegistry, { target: "draft-2020-12", io: "input", uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Record<string, unknown>> };
  const schemas: Record<string, unknown> = {};
  for (const [id, js] of Object.entries(generated.schemas)) {
    const { $schema: _s, $id: _i, ...rest } = js;
    schemas[id] = rest;
  }
  const paths: Record<string, Record<string, unknown>> = {};
  for (const o of OPS) {
    const errors = { 400: { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, 401: { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }, 404: { description: "Not found" }, 429: { description: "Rate limited — see Retry-After" } };
    paths[o.path] ??= {};
    paths[o.path]![o.method] = {
      summary: o.summary, tags: [o.tag], operationId: `${o.method}${o.path.replace(/\{(\w+)\}/g, "By$1").replace(/[^a-zA-Z]+(\w)/g, (_m, c: string) => c.toUpperCase())}`,
      security: [{ bearer: [] }],
      parameters: [
        ...(o.params ?? []).map((p) => ({ name: p, in: "path", required: true, schema: { type: "string" } })),
        ...(o.list ? [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }, { name: "cursor", in: "query", schema: { type: "string" }, description: "next_cursor from the previous page" }] : []),
        ...(o.idempotent ? [{ name: "Idempotency-Key", in: "header", schema: { type: "string", maxLength: 255 }, description: "Safely retry: the same key returns the original response for 24 hours." }] : []),
      ],
      ...(o.body ? { requestBody: { required: true, content: { "application/json": { schema: ref(o.body) } } } } : {}),
      responses: { [String(o.status ?? 200)]: { description: "OK", content: { "application/json": { schema: ref(o.response) } } }, ...errors, ...(o.write ? { 403: { description: "Key is read-only" } } : {}) },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Hearthstead API", version: "1.0.0",
      description: "REST API for properties, units, tenants, leases, ledger balances and maintenance tasks.\n\n- Authenticate with `Authorization: Bearer hs_live_…` (or `hs_test_…` for your sandbox).\n- Money is integer cents. Lists use cursor pagination (`limit`, `cursor`, `next_cursor`).\n- 120 requests/minute per key (`X-RateLimit-*` headers).\n- Send `Idempotency-Key` on POST/PATCH to retry safely.\n- Webhooks are signed: `Hearthstead-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t + '.' + body)>`.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key from Settings → Integrations" } }, schemas },
    paths,
    webhooks: Object.fromEntries(["lease.created", "lease.ended", "payment.succeeded", "payment.failed", "task.created", "task.updated", "application.submitted"].map((e) => [e, { post: { summary: e, requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, type: { const: e }, created_at: { type: "string" }, data: { type: "object" } } } } } }, responses: { 200: { description: "Return any 2xx to acknowledge" } } } }])),
  };
}

export const API_OPERATIONS = OPS.map((o) => ({ method: o.method.toUpperCase(), path: o.path, summary: o.summary, tag: o.tag, write: Boolean(o.write) }));
