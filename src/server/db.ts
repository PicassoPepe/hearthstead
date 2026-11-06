import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * Two connections:
 *  - adminDb: table owner. Bypasses RLS. Use ONLY for auth lookups, migrations/seed, and
 *    explicitly system-level jobs. Never hand it to request-scoped business code.
 *  - appDb:   `hearthstead_app` role. RLS enforced. Wrap with `forOrg()` (src/server/dal).
 */
const globalForPrisma = globalThis as unknown as {
  adminDb?: PrismaClient;
  appDb?: PrismaClient;
};

function make(url: string | undefined): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const adminDb: PrismaClient =
  globalForPrisma.adminDb ?? make(process.env.DATABASE_ADMIN_URL);
export const appDb: PrismaClient = globalForPrisma.appDb ?? make(process.env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.adminDb = adminDb;
  globalForPrisma.appDb = appDb;
}
