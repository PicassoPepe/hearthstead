import { SETTINGS, type Scope, type SettingKey, type SettingValue } from "./registry";

/**
 * Pure inheritance resolver: lease ?? property ?? org ?? default.
 * Stored values that fail schema validation are ignored (fall through to the next layer),
 * so a bad row can never crash a page or a nightly job.
 */
export type SettingSource = Scope | "DEFAULT";

export type SettingLayers = Partial<Record<Scope, unknown>>;

export type Resolved<K extends SettingKey> = {
  key: K;
  value: SettingValue<K>;
  source: SettingSource;
  /** What this scope would inherit if its own override were removed. */
  inherited: { value: SettingValue<K>; source: SettingSource };
};

const ORDER: readonly Scope[] = ["LEASE", "PROPERTY", "ORG"];

export function resolveSetting<K extends SettingKey>(
  key: K,
  layers: SettingLayers,
  at: Scope = "LEASE",
): Resolved<K> {
  const d = SETTINGS[key];
  const startIdx = ORDER.indexOf(at);
  const candidates = ORDER.slice(startIdx).filter((s) => d.scopes.includes(s));

  const found: { value: SettingValue<K>; source: SettingSource }[] = [];
  for (const scope of candidates) {
    if (!(scope in layers) || layers[scope] === undefined) continue;
    const parsed = d.schema.safeParse(layers[scope]);
    if (parsed.success) found.push({ value: parsed.data as SettingValue<K>, source: scope });
  }
  const fallback = { value: d.default as SettingValue<K>, source: "DEFAULT" as const };
  const winner = found[0] ?? fallback;
  // "inherited" = best value from scopes strictly above `at`.
  const above = found.find((f) => f.source !== at) ?? fallback;
  return { key, value: winner.value, source: winner.source, inherited: above };
}

export const SOURCE_LABEL: Record<SettingSource, string> = {
  LEASE: "Lease",
  PROPERTY: "Property",
  ORG: "Company",
  DEFAULT: "Default",
};
