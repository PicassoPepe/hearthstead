import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers detection. The OpenNext package is safe to import on Node: it only
 * reaches for Wrangler when a dev binding is actually requested.
 */
export function onCloudflareWorkers(): boolean {
  if (process.env.DEEDWOOD_RUNTIME === "cloudflare") return true;
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export type WorkersAi = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type CfBindings = {
  AI?: WorkersAi;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  DATABASE_ADMIN_URL?: string;
  AUTH_SECRET?: string;
};

export type CfContext = {
  env: CfBindings;
  ctx: { waitUntil(promise: Promise<unknown>): void };
};

/** Bindings for the current request. Null on Node, and null if called outside a request. */
export function cloudflareContext(): CfContext | null {
  if (!onCloudflareWorkers()) return null;
  try {
    return getCloudflareContext() as unknown as CfContext;
  } catch {
    return null;
  }
}

export function workersAiBinding(): WorkersAi | null {
  return cloudflareContext()?.env.AI ?? null;
}
