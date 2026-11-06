import { describe, expect, it } from "vitest";
import { resolveSetting } from "@/server/settings/resolver";
import { SETTINGS, isSettingKey, type SettingKey } from "@/server/settings/registry";

describe("resolveSetting: lease ?? property ?? org ?? default", () => {
  it("falls back to the registry default", () => {
    const r = resolveSetting("lateFees.graceDays", {});
    expect(r).toMatchObject({ value: 5, source: "DEFAULT", inherited: { value: 5, source: "DEFAULT" } });
  });

  it("org overrides default", () => {
    expect(resolveSetting("lateFees.graceDays", { ORG: 3 })).toMatchObject({ value: 3, source: "ORG" });
  });

  it("property overrides org", () => {
    expect(resolveSetting("lateFees.graceDays", { ORG: 3, PROPERTY: 7 })).toMatchObject({ value: 7, source: "PROPERTY" });
  });

  it("lease overrides property and org", () => {
    const r = resolveSetting("lateFees.graceDays", { ORG: 3, PROPERTY: 7, LEASE: 10 });
    expect(r).toMatchObject({ value: 10, source: "LEASE", inherited: { value: 7, source: "PROPERTY" } });
  });

  it("lease value wins even when property is unset", () => {
    expect(resolveSetting("lateFees.graceDays", { ORG: 3, LEASE: 1 })).toMatchObject({ value: 1, source: "LEASE", inherited: { value: 3, source: "ORG" } });
  });

  it("a falsy override (false / 0) is a real value, not 'unset'", () => {
    expect(resolveSetting("lateFees.enabled", { ORG: true, LEASE: false })).toMatchObject({ value: false, source: "LEASE" });
    expect(resolveSetting("lateFees.graceDays", { ORG: 3, PROPERTY: 0 })).toMatchObject({ value: 0, source: "PROPERTY" });
  });

  it("resolving AT a scope ignores deeper scopes and reports what it would inherit", () => {
    const layers = { ORG: 3, PROPERTY: 7, LEASE: 10 };
    expect(resolveSetting("lateFees.graceDays", layers, "PROPERTY")).toMatchObject({
      value: 7, source: "PROPERTY", inherited: { value: 3, source: "ORG" },
    });
    expect(resolveSetting("lateFees.graceDays", layers, "ORG")).toMatchObject({
      value: 3, source: "ORG", inherited: { value: 5, source: "DEFAULT" },
    });
  });

  it("ignores invalid stored values and falls through to the next layer", () => {
    expect(resolveSetting("lateFees.graceDays", { ORG: 3, PROPERTY: "seven", LEASE: -1 })).toMatchObject({ value: 3, source: "ORG" });
    expect(resolveSetting("lateFees.type", { ORG: "BOGUS" })).toMatchObject({ value: "FLAT", source: "DEFAULT" });
  });

  it("ignores layers a setting does not allow (application fee has no lease scope)", () => {
    expect(resolveSetting("applications.feeCents", { ORG: 5000, LEASE: 1 })).toMatchObject({ value: 5000, source: "ORG" });
  });

  it("every registered default passes its own schema", () => {
    for (const k of Object.keys(SETTINGS) as SettingKey[]) {
      expect(SETTINGS[k].schema.safeParse(SETTINGS[k].default).success, k).toBe(true);
      expect(SETTINGS[k].scopes).toContain("ORG");
    }
  });

  it("isSettingKey guards unknown keys", () => {
    expect(isSettingKey("lateFees.graceDays")).toBe(true);
    expect(isSettingKey("__proto__")).toBe(false);
    expect(isSettingKey("nope")).toBe(false);
  });
});
