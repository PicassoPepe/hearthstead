import { SETTINGS, type Scope, type SettingInput, type SettingKey } from "./registry";
import type { Resolved, SettingSource } from "./resolver";

/** Serializable (client-safe) view of a setting + its resolved value at a scope. */
export type SettingRowData = {
  key: SettingKey;
  label: string;
  help?: string;
  input: SettingInput;
  scopes: Scope[];
  value: unknown;
  source: SettingSource;
  inheritedValue: unknown;
  inheritedSource: SettingSource;
};

export function toRowData<K extends SettingKey>(r: Resolved<K>): SettingRowData {
  const d = SETTINGS[r.key];
  return {
    key: r.key,
    label: d.label,
    help: "help" in d ? (d.help as string | undefined) : undefined,
    input: d.input,
    scopes: [...d.scopes],
    value: r.value,
    source: r.source,
    inheritedValue: r.inherited.value,
    inheritedSource: r.inherited.source,
  };
}
