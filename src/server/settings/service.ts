import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";
import { SETTINGS, type Scope, type SettingKey, type SettingValue } from "./registry";
import { resolveSetting, type Resolved, type SettingLayers } from "./resolver";

export type SettingTarget = { orgId: string; propertyId?: string | null; leaseId?: string | null };

function deepestScope(t: SettingTarget): Scope {
  return t.leaseId ? "LEASE" : t.propertyId ? "PROPERTY" : "ORG";
}

/** Load all layers for many keys in a single query and resolve them. */
export async function getSettings<K extends SettingKey>(
  db: ScopedDb,
  keys: readonly K[],
  target: SettingTarget,
): Promise<{ [P in K]: Resolved<P> }> {
  const or: Prisma.SettingWhereInput[] = [{ scope: "ORG", scopeId: target.orgId }];
  if (target.propertyId) or.push({ scope: "PROPERTY", scopeId: target.propertyId });
  if (target.leaseId) or.push({ scope: "LEASE", scopeId: target.leaseId });
  const rows = await db.setting.findMany({ where: { key: { in: [...keys] }, OR: or } });
  const layersByKey = new Map<string, SettingLayers>();
  for (const r of rows) {
    const l = layersByKey.get(r.key) ?? {};
    l[r.scope] = r.value;
    layersByKey.set(r.key, l);
  }
  const at = deepestScope(target);
  const out = {} as { [P in K]: Resolved<P> };
  for (const k of keys) out[k] = resolveSetting(k, layersByKey.get(k) ?? {}, at) as Resolved<typeof k>;
  return out;
}

/** getSetting(key, {orgId, propertyId?, leaseId?}) → lease ?? property ?? org ?? default */
export async function getSetting<K extends SettingKey>(
  db: ScopedDb,
  key: K,
  target: SettingTarget,
): Promise<SettingValue<K>> {
  const r = await getSettings(db, [key], target);
  return r[key].value;
}

export class SettingValidationError extends Error {}

export async function setSetting<K extends SettingKey>(
  db: ScopedDb,
  key: K,
  scope: Scope,
  scopeId: string,
  value: unknown,
): Promise<{ before: unknown; after: SettingValue<K> }> {
  const d = SETTINGS[key];
  if (!d.scopes.includes(scope)) throw new SettingValidationError(`${d.label} cannot be overridden at ${scope} level`);
  const parsed = d.schema.safeParse(value);
  if (!parsed.success) throw new SettingValidationError(`Invalid value for ${d.label}`);
  const orgId = db.ctx.orgId;
  const existing = await db.setting.findFirst({ where: { scope, scopeId, key } });
  await db.setting.upsert({
    where: { organizationId_scope_scopeId_key: { organizationId: orgId, scope, scopeId, key } },
    create: { organizationId: orgId, scope, scopeId, key, value: parsed.data as Prisma.InputJsonValue, createdById: db.ctx.userId },
    update: { value: parsed.data as Prisma.InputJsonValue, deletedAt: null },
  });
  return { before: existing?.value ?? null, after: parsed.data as SettingValue<K> };
}

/** Remove an override so the scope inherits again. ORG overrides fall back to the default. */
export async function clearSetting(db: ScopedDb, key: SettingKey, scope: Scope, scopeId: string): Promise<void> {
  await db.setting.deleteMany({ where: { scope, scopeId, key } });
}
