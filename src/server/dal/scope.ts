import { Prisma } from "@prisma/client";

/**
 * Pure helpers that rewrite Prisma query args so every query is pinned to one organization.
 * This is the application-level half of tenant isolation; Postgres RLS is the other half.
 */

type ModelMeta = { orgField: "organizationId" | "id" | null; softDelete: boolean };

const META: Record<string, ModelMeta> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => {
    const names = new Set(m.fields.map((f) => f.name));
    const orgField: ModelMeta["orgField"] =
      m.name === "Organization" ? "id" : names.has("organizationId") ? "organizationId" : null;
    return [m.name, { orgField, softDelete: names.has("deletedAt") }];
  }),
);

export function modelMeta(model: string): ModelMeta {
  return META[model] ?? { orgField: null, softDelete: false };
}

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

export class CrossTenantError extends Error {
  constructor(model: string) {
    super(`Refusing cross-tenant access on ${model}`);
    this.name = "CrossTenantError";
  }
}

type Args = Record<string, unknown>;

function stampData(model: string, field: string, orgId: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(model, field, orgId, d));
  if (data && typeof data === "object") {
    const d = data as Args;
    if (field === "id") return d; // creating Organizations is a system operation
    // A nested `organization: { connect }` is checked by RLS; reject mismatches early.
    const existing = d[field];
    if (existing !== undefined && existing !== orgId) throw new CrossTenantError(model);
    if ("organization" in d) return d;
    return { ...d, [field]: orgId };
  }
  return data;
}

/**
 * Returns new args with organization scoping (and soft-delete filtering for reads) applied.
 * `includeDeleted: true` in where-less contexts is not supported; pass `deletedAt` explicitly
 * in `where` to opt out of the soft-delete filter.
 */
export function scopeArgs(model: string, operation: string, args: Args | undefined, orgId: string): Args {
  const meta = modelMeta(model);
  const a: Args = { ...(args ?? {}) };
  if (!meta.orgField) return a;
  const field = meta.orgField;

  if (WHERE_OPS.has(operation)) {
    const where = { ...((a.where as Args | undefined) ?? {}) };
    if (where[field] !== undefined && where[field] !== orgId) throw new CrossTenantError(model);
    where[field] = orgId;
    if (meta.softDelete && READ_OPS.has(operation) && !("deletedAt" in where)) {
      where.deletedAt = null;
    }
    a.where = where;
  }
  if (CREATE_OPS.has(operation)) {
    if (field === "id") throw new CrossTenantError(model);
    a.data = stampData(model, field, orgId, a.data);
  }
  if (operation === "upsert") {
    a.create = stampData(model, field, orgId, a.create);
    const upd = a.update as Args | undefined;
    if (upd && upd[field] !== undefined && upd[field] !== orgId) throw new CrossTenantError(model);
  }
  if ((operation === "update" || operation === "updateMany") && a.data) {
    const d = a.data as Args;
    if (d[field] !== undefined && d[field] !== orgId) throw new CrossTenantError(model);
  }
  return a;
}
