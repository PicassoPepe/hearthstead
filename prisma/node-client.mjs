/**
 * Prisma for Node (Windows one-click, tests, GitHub Actions migrate).
 * The client is generated with engineType = "client", so it needs a driver adapter.
 * Workers do not use this file; they use the Neon adapter in src/server/db.ts.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createNodePrisma(url) {
  const connectionString = url || process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set DATABASE_ADMIN_URL or DATABASE_URL");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
