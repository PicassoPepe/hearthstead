import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { createScopedClient } from "@/server/dal";
import { CrossTenantError } from "@/server/dal/scope";
import { BUILT_IN_ROLES } from "@/server/permissions";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };

beforeAll(async () => {
  A = await makeOrg("A");
  B = await makeOrg("B");
  await admin.setting.createMany({
    data: [
      { organizationId: A.orgId, scope: "ORG", scopeId: A.orgId, key: "lateFees.graceDays", value: 3 },
      { organizationId: B.orgId, scope: "ORG", scopeId: B.orgId, key: "lateFees.graceDays", value: 9 },
    ],
  });
});

afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("organization provisioning", () => {
  it("creates every built-in role and an active Admin membership", async () => {
    const roles = await admin.role.findMany({ where: { organizationId: A.orgId } });
    expect(roles.map((r) => r.key).sort()).toEqual(Object.keys(BUILT_IN_ROLES).sort());
    const m = await admin.membership.findFirstOrThrow({ where: { organizationId: A.orgId }, include: { role: true } });
    expect(m).toMatchObject({ userId: A.userId, status: "ACTIVE", role: { key: "ADMIN" } });
  });
});

describe("data-access layer", () => {
  it("only returns the current org's rows", async () => {
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    const rows = await dbA.setting.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: A.orgId, value: 3 });
    expect(await dbA.role.count()).toBe(Object.keys(BUILT_IN_ROLES).length);
  });

  it("stamps organizationId on create", async () => {
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    const log = await dbA.auditLog.create({ data: { action: "test", entityType: "Test" } as Prisma.AuditLogUncheckedCreateInput });
    expect(log.organizationId).toBe(A.orgId);
  });

  it("refuses explicit cross-tenant access before it reaches the database", async () => {
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    await expect(dbA.setting.findMany({ where: { organizationId: B.orgId } })).rejects.toThrow(CrossTenantError);
    await expect(
      dbA.setting.create({ data: { organizationId: B.orgId, scope: "ORG", scopeId: B.orgId, key: "x", value: 1 } }),
    ).rejects.toThrow(CrossTenantError);
  });

  it("cannot update or delete another org's row by id", async () => {
    const bRole = await admin.role.findFirstOrThrow({ where: { organizationId: B.orgId, key: "VENDOR" } });
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    await expect(dbA.role.update({ where: { id: bRole.id }, data: { name: "pwned" } })).rejects.toThrow();
    const res = await dbA.role.deleteMany({ where: { id: bRole.id } });
    expect(res.count).toBe(0);
    expect((await admin.role.findUniqueOrThrow({ where: { id: bRole.id } })).name).toBe("Vendor");
  });

  it("hides soft-deleted rows by default", async () => {
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    const s = await dbA.setting.create({ data: { organizationId: A.orgId, scope: "ORG", scopeId: A.orgId, key: "tmp.soft", value: 1 } });
    await dbA.setting.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    expect(await dbA.setting.findFirst({ where: { key: "tmp.soft" } })).toBeNull();
    expect(await dbA.setting.findFirst({ where: { key: "tmp.soft", deletedAt: { not: null } } })).not.toBeNull();
  });

  it("interactive transactions keep the tenant context", async () => {
    const dbA = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
    const n = await dbA.tx(async (tx) => {
      await tx.auditLog.create({ data: { action: "in-tx", entityType: "Test" } as Prisma.AuditLogUncheckedCreateInput });
      return tx.auditLog.count({ where: { action: "in-tx" } });
    });
    expect(n).toBe(1);
  });
});

describe("Postgres row-level security (DAL bypassed)", () => {
  it("the app role sees nothing without a tenant context", async () => {
    expect(await app.setting.count()).toBe(0);
    expect(await app.organization.count()).toBe(0);
  });

  it("raw SQL under org A cannot read org B", async () => {
    const [, rows] = await app.$transaction([
      app.$executeRaw`SELECT set_config('app.org_id', ${A.orgId}, true)`,
      app.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM "Setting"`,
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === A.orgId)).toBe(true);
  });

  it("raw SQL under org A cannot write a row for org B", async () => {
    await expect(
      app.$transaction([
        app.$executeRaw`SELECT set_config('app.org_id', ${A.orgId}, true)`,
        app.$executeRaw`INSERT INTO "Setting" (id, "organizationId", scope, "scopeId", key, value, "updatedAt") VALUES ('evil', ${B.orgId}, 'ORG', ${B.orgId}, 'k', '1', now())`,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("raw SQL under org A cannot update org B's rows", async () => {
    const [, updated] = await app.$transaction([
      app.$executeRaw`SELECT set_config('app.org_id', ${A.orgId}, true)`,
      app.$executeRaw`UPDATE "Setting" SET value = '99' WHERE "organizationId" = ${B.orgId}`,
    ]);
    expect(updated).toBe(0);
  });

  it("users can see their own memberships across orgs (for the org switcher) but not others'", async () => {
    const [, rows] = await app.$transaction([
      app.$executeRaw`SELECT set_config('app.user_id', ${B.userId}, true)`,
      app.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM "Membership"`,
    ]);
    expect(rows.map((r) => r.organizationId)).toEqual([B.orgId]);
  });
});
