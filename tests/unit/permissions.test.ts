import { describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, MODULES, can, canAccessProperty, parsePermissions } from "@/server/permissions";

describe("can()", () => {
  it("ranks none < view < edit < delete", () => {
    const p = { rentals: "edit" as const };
    expect(can(p, "rentals", "view")).toBe(true);
    expect(can(p, "rentals", "edit")).toBe(true);
    expect(can(p, "rentals", "delete")).toBe(false);
    expect(can(p, "accounting", "view")).toBe(false);
  });
});

describe("built-in roles", () => {
  it("Admin has full access to every module", () => {
    for (const m of MODULES) expect(can(BUILT_IN_ROLES.ADMIN.permissions, m, "delete")).toBe(true);
  });
  it("Vendor sees only tasks and files", () => {
    const allowed = MODULES.filter((m) => can(BUILT_IN_ROLES.VENDOR.permissions, m, "view"));
    expect(allowed.sort()).toEqual(["files", "tasks"]);
    expect(can(BUILT_IN_ROLES.VENDOR.permissions, "tasks", "edit")).toBe(false);
  });
  it("Bookkeeper owns accounting but cannot manage users", () => {
    expect(can(BUILT_IN_ROLES.BOOKKEEPER.permissions, "accounting", "delete")).toBe(true);
    expect(can(BUILT_IN_ROLES.BOOKKEEPER.permissions, "users", "view")).toBe(false);
  });
  it("Read-only owner can never edit", () => {
    for (const m of MODULES) expect(can(BUILT_IN_ROLES.OWNER_READONLY.permissions, m, "edit")).toBe(false);
  });
  it("Property manager cannot change company settings or users", () => {
    expect(can(BUILT_IN_ROLES.PROPERTY_MANAGER.permissions, "settings", "edit")).toBe(false);
    expect(can(BUILT_IN_ROLES.PROPERTY_MANAGER.permissions, "users", "edit")).toBe(false);
    expect(can(BUILT_IN_ROLES.PROPERTY_MANAGER.permissions, "leasing", "edit")).toBe(true);
  });
});

describe("parsePermissions", () => {
  it("drops unknown modules and invalid levels from untrusted JSON", () => {
    expect(parsePermissions({ rentals: "edit", hacking: "delete", accounting: "superuser" })).toEqual({ rentals: "edit" });
    expect(parsePermissions(null)).toEqual({});
    expect(parsePermissions("admin")).toEqual({});
  });
});

describe("property scoping", () => {
  it("empty scope means every property", () => {
    expect(canAccessProperty([], "p1")).toBe(true);
    expect(canAccessProperty(["p1"], "p1")).toBe(true);
    expect(canAccessProperty(["p1"], "p2")).toBe(false);
  });
});
