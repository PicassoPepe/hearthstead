import { Prisma, type PrismaClient } from "@prisma/client";
import { scopeArgs } from "./scope";

/** `impersonatorId`: the platform owner acting as `userId` ("view as" from /admin) — recorded on every audit row. */
export type OrgContext = { orgId: string; userId: string | null; impersonatorId?: string | null };

function setContextSql(ctx: OrgContext) {
  return Prisma.sql`SELECT set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
}

/**
 * Build a tenant-scoped client from a base client that connects as the RLS-restricted role.
 *  - Every model operation gets organizationId injected (data-access layer).
 *  - Every operation runs in a transaction that first sets `app.org_id` (Postgres RLS).
 *  - `tx(fn)` runs an interactive transaction with the context set once.
 */
export function createScopedClient(base: PrismaClient, ctx: OrgContext) {
  const scoped = base.$extends({
    name: "org-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Record<string, unknown>, ctx.orgId) as typeof args);
        },
      },
    },
  });

  const withRls = scoped.$extends({
    name: "org-rls",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([base.$executeRaw(setContextSql(ctx)), query(args)]);
          return result;
        },
      },
    },
  });

  type ScopedTx = Parameters<Parameters<typeof scoped.$transaction>[0]>[0];

  return Object.assign(withRls, {
    ctx,
    /** Interactive transaction with tenant context applied to every statement inside. */
    tx<T>(fn: (tx: ScopedTx) => Promise<T>, options?: { timeout?: number }): Promise<T> {
      return scoped.$transaction(
        async (tx) => {
          await tx.$executeRaw(setContextSql(ctx));
          return fn(tx);
        },
        { timeout: options?.timeout ?? 15_000 },
      );
    },
  });
}

export type ScopedDb = ReturnType<typeof createScopedClient>;
/** The client handed to `db.tx(async (tx) => …)`: tenant-scoped, inside one transaction. */
export type ScopedTx = Parameters<Parameters<ScopedDb["tx"]>[0]>[0];
