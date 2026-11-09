import "server-only";
import { cache } from "react";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { neonConfig } from "@neondatabase/serverless";
import { cloudflareContext, onCloudflareWorkers, type CfContext } from "@/server/runtime";

/**
 * Two connections:
 *  - adminDb: table owner. Bypasses RLS. Auth lookups, system jobs. Not for request business code.
 *  - appDb:   `deedwood_app` role. RLS enforced. Wrap with `forOrg()`.
 *
 * The generated client uses engineType = "client" (JS query compiler). It cannot use the Rust
 * engine, which does not run on Workers. Node (desktop, tests, Railway) talks to Postgres
 * through `pg`. Workers talk to Neon through the Neon WebSocket driver so interactive
 * transactions (row-level security's set_config) work. Each Workers request gets its own client.
 */
const globalForPrisma = globalThis as unknown as {
  adminDb?: PrismaClient;
  appDb?: PrismaClient;
};

type Pair = { admin: PrismaClient; app: PrismaClient };

function logLevel(): ("warn" | "error")[] {
  return process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
}

function neonHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return url.includes(".neon.tech");
  }
}

function makePg(url: string | undefined): PrismaClient {
  const connectionString = url || process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "";
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), log: logLevel() });
}

function makeNeon(url: string): PrismaClient {
  // The Neon driver otherwise tries to import the Node `ws` package, which Workers do not have.
  neonConfig.webSocketConstructor = WebSocket;
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }), log: ["error"] });
}

function makeWorkers(url: string): PrismaClient {
  return url && neonHost(url) ? makeNeon(url) : makePg(url);
}

let nodeProd: Pair | undefined;
function nodePair(): Pair {
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.adminDb ??= makePg(process.env.DATABASE_ADMIN_URL);
    globalForPrisma.appDb ??= makePg(process.env.DATABASE_URL);
    return { admin: globalForPrisma.adminDb, app: globalForPrisma.appDb };
  }
  nodeProd ??= { admin: makePg(process.env.DATABASE_ADMIN_URL), app: makePg(process.env.DATABASE_URL) };
  return nodeProd;
}

function workersPairFrom(env: CfContext["env"]): Pair {
  const adminUrl = env.DATABASE_ADMIN_URL || process.env.DATABASE_ADMIN_URL || "";
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  const appUrl = hyperdrive || env.DATABASE_URL || process.env.DATABASE_URL || "";
  return {
    admin: makeWorkers(adminUrl),
    // Hyperdrive is a local Postgres URL. The Neon pooler URL uses the Neon driver.
    app: hyperdrive ? makePg(hyperdrive) : makeWorkers(appUrl),
  };
}

const workersRequestPair = cache((): Pair => {
  const cf = cloudflareContext();
  const pair = workersPairFrom(cf?.env ?? {});
  cf?.ctx.waitUntil(Promise.all([pair.admin.$disconnect(), pair.app.$disconnect()]).then(() => undefined));
  return pair;
});

// Used only when React cache() has no request store. One pair per isolate, not one per property.
let workersFallback: Pair | undefined;
function pair(): Pair {
  if (!onCloudflareWorkers()) return nodePair();
  try {
    return workersRequestPair();
  } catch {
    workersFallback ??= workersPairFrom(cloudflareContext()?.env ?? {});
    return workersFallback;
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
