import "server-only";
import { cache } from "react";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { neonConfig } from "@neondatabase/serverless";
import { cloudflareContext, onCloudflareWorkers, type CfContext } from "@/server/runtime";

/**
 * Two connections:
 *  - adminDb: table owner. Bypasses RLS. Use ONLY for auth lookups, migrations/seed, and
 *    explicitly system-level jobs. Never hand it to request-scoped business code.
 *  - appDb:   `deedwood_app` role. RLS enforced. Wrap with `forOrg()` (src/server/dal).
 *
 * On Node (desktop, tests, Railway) these are long-lived clients using the Prisma TCP engine.
 * On Cloudflare Workers there is no durable TCP pool: each request gets its own client
 * (React `cache()`), using Hyperdrive + `pg` when that binding exists, otherwise the Neon
 * WebSocket driver. Both support the interactive transactions row-level security needs
 * (`set_config(..., true)` inside a transaction).
 */
const globalForPrisma = globalThis as unknown as {
  adminDb?: PrismaClient;
  appDb?: PrismaClient;
};

type Pair = { admin: PrismaClient; app: PrismaClient };

function logLevel(): ("warn" | "error")[] {
  return process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
}

function makeNode(url: string | undefined): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: logLevel(),
  });
}

let nodeProd: Pair | undefined;
function nodePair(): Pair {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.adminDb ??= makeNode(process.env.DATABASE_ADMIN_URL);
    globalForPrisma.appDb ??= makeNode(process.env.DATABASE_URL);
    return { admin: globalForPrisma.adminDb, app: globalForPrisma.appDb };
  }
  nodeProd ??= { admin: makeNode(process.env.DATABASE_ADMIN_URL), app: makeNode(process.env.DATABASE_URL) };
  return nodeProd;
}

function makeNeon(url: string): PrismaClient {
  if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }), log: ["error"] });
}

function makeHyperdrive(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: ["error"] });
}

function workersPairFrom(env: CfContext["env"]): Pair {
  const adminUrl = env.DATABASE_ADMIN_URL || process.env.DATABASE_ADMIN_URL || "";
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  const appUrl = hyperdrive || env.DATABASE_URL || process.env.DATABASE_URL || "";
  return {
    admin: makeNeon(adminUrl),
    app: hyperdrive ? makeHyperdrive(hyperdrive) : makeNeon(appUrl),
  };
}

const workersPair = cache((): Pair => {
  const cf = cloudflareContext();
  const pair = workersPairFrom(cf?.env ?? {});
  cf?.ctx.waitUntil(Promise.all([pair.admin.$disconnect(), pair.app.$disconnect()]).then(() => undefined));
  return pair;
});

function pair(): Pair {
  if (!onCloudflareWorkers()) return nodePair();
  try {
    return workersPair();
  } catch {
    return workersPairFrom(cloudflareContext()?.env ?? {});
  }
}

function proxy(which: keyof Pair): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = pair()[which];
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
    },
  });
}

export const adminDb: PrismaClient = proxy("admin");
export const appDb: PrismaClient = proxy("app");
