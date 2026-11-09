import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MODEL_META } from "@/server/dal/model-meta.generated";
import { CrossTenantError, scopeArgs } from "@/server/dal/scope";

const ORG = "org_a";

describe("scopeArgs (data-access layer tenant pinning)", () => {
  it("adds organizationId and soft-delete filter to reads", () => {
    expect(scopeArgs("Setting", "findMany", { where: { key: "x" } }, ORG)).toEqual({
      where: { key: "x", organizationId: ORG, deletedAt: null },
    });
    expect(scopeArgs("Role", "count", undefined, ORG)).toEqual({ where: { organizationId: ORG, deletedAt: null } });
  });

  it("respects an explicit deletedAt filter", () => {
    expect(scopeArgs("Membership", "findFirst", { where: { deletedAt: { not: null } } }, ORG)).toEqual({
      where: { deletedAt: { not: null }, organizationId: ORG },
    });
  });

  it("pins writes (update/delete) without adding the soft-delete filter", () => {
    expect(scopeArgs("Role", "update", { where: { id: "r1" }, data: { name: "x" } }, ORG)).toEqual({
      where: { id: "r1", organizationId: ORG },
      data: { name: "x" },
    });
    expect(scopeArgs("Setting", "deleteMany", { where: { key: "k" } }, ORG)).toEqual({ where: { key: "k", organizationId: ORG } });
  });

  it("stamps organizationId on create and createMany", () => {
    expect(scopeArgs("AuditLog", "create", { data: { action: "a" } }, ORG)).toEqual({ data: { action: "a", organizationId: ORG } });
    expect(scopeArgs("AuditLog", "createMany", { data: [{ action: "a" }, { action: "b" }] }, ORG)).toEqual({
      data: [{ action: "a", organizationId: ORG }, { action: "b", organizationId: ORG }],
    });
  });

  it("scopes upsert where + create", () => {
    expect(scopeArgs("Setting", "upsert", { where: { id: "s" }, create: { key: "k" }, update: { value: 1 } }, ORG)).toEqual({
      where: { id: "s", organizationId: ORG },
      create: { key: "k", organizationId: ORG },
      update: { value: 1 },
    });
  });

  it("scopes Organization by its id", () => {
    expect(scopeArgs("Organization", "findUnique", { where: { id: ORG } }, ORG)).toEqual({ where: { id: ORG, deletedAt: null } });
    expect(() => scopeArgs("Organization", "findUnique", { where: { id: "org_b" } }, ORG)).toThrow(CrossTenantError);
    expect(() => scopeArgs("Organization", "create", { data: { name: "x" } }, ORG)).toThrow(CrossTenantError);
  });

  it("rejects explicit cross-tenant ids everywhere", () => {
    expect(() => scopeArgs("Setting", "findMany", { where: { organizationId: "org_b" } }, ORG)).toThrow(CrossTenantError);
    expect(() => scopeArgs("Setting", "create", { data: { organizationId: "org_b" } }, ORG)).toThrow(CrossTenantError);
    expect(() => scopeArgs("Role", "update", { where: { id: "r" }, data: { organizationId: "org_b" } }, ORG)).toThrow(CrossTenantError);
    expect(() => scopeArgs("Setting", "upsert", { where: {}, create: {}, update: { organizationId: "org_b" } }, ORG)).toThrow(CrossTenantError);
  });

  it("leaves global models (User, auth tables) untouched", () => {
    expect(scopeArgs("User", "findMany", { where: { email: "a" } }, ORG)).toEqual({ where: { email: "a" } });
    expect(scopeArgs("VerificationToken", "deleteMany", {}, ORG)).toEqual({});
  });

  it("matches Prisma.dmmf so Workers do not need the edge-blocked getter", () => {
    const fromDmmf = Object.fromEntries(Prisma.dmmf.datamodel.models.map((m) => {
      const names = new Set(m.fields.map((f) => f.name));
      const orgField = m.name === "Organization" ? "id" : names.has("organizationId") ? "organizationId" : null;
      return [m.name, { orgField, softDelete: names.has("deletedAt") }];
    }));
    expect(MODEL_META).toEqual(fromDmmf);
  });
});
