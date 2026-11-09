import IORedis from "ioredis";

/**
 * Limits on the sign-in doors (password, sign-up, email links, two-factor codes).
 * Counts live in Redis when REDIS_URL is set (shared by every server), otherwise in this
 * process's memory — fine for a single server and the one-click local install.
 *
 * Fixed windows: simple, predictable, and good enough to stop password guessing.
 */
export type Rule = { limit: number; windowSec: number };

export const RULES = {
  /** Any password sign-in attempt from one address. */
  loginIp: { limit: 30, windowSec: 15 * 60 },
  /** Wrong passwords / codes for one account → that account is locked for the rest of the window. */
  loginFailEmail: { limit: 8, windowSec: 15 * 60 },
  signupIp: { limit: 6, windowSec: 60 * 60 },
  magicIp: { limit: 10, windowSec: 15 * 60 },
  magicEmail: { limit: 4, windowSec: 15 * 60 },
  /** Two-factor setup / turn-off codes in Settings → Security. */
  totpUser: { limit: 10, windowSec: 15 * 60 },
} satisfies Record<string, Rule>;
export type RuleName = keyof typeof RULES;

type Store = { incr(key: string, windowSec: number): Promise<number>; get(key: string): Promise<number>; del(key: string): Promise<void> };

const mem = new Map<string, { n: number; until: number }>();
let clock = () => Date.now();
/** Tests: control time. */
export function setClock(f: () => number) { clock = f; }
export function resetMemoryLimits() { mem.clear(); }

const memoryStore: Store = {
  async incr(key, windowSec) {
    const now = clock();
    const cur = mem.get(key);
    const next = cur && cur.until > now ? { n: cur.n + 1, until: cur.until } : { n: 1, until: now + windowSec * 1000 };
    mem.set(key, next);
    if (mem.size > 20_000) for (const [k, v] of mem) if (v.until <= now) mem.delete(k);
    return next.n;
  },
  async get(key) {
    const cur = mem.get(key);
    return cur && cur.until > clock() ? cur.n : 0;
  },
  async del(key) { mem.delete(key); },
};

let redis: IORedis | null | undefined;
function redisStore(): Store | null {
  if (!process.env.REDIS_URL) return null;
  if (redis === undefined) {
    try {
      redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
      redis.on("error", () => undefined);
      void redis.connect().catch(() => { redis = null; });
    } catch {
      redis = null;
    }
  }
  const r = redis;
  if (!r || r.status !== "ready") return null;
  return {
    async incr(key, windowSec) {
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, windowSec);
      return n;
    },
    async get(key) { return Number((await r.get(key)) ?? 0); },
    async del(key) { await r.del(key); },
  };
}
const store = (): Store => redisStore() ?? memoryStore;
const keyFor = (rule: RuleName, who: string) => `authrl:${rule}:${who.toLowerCase()}`;

export class RateLimited extends Error {
  constructor(public retryAfterSec: number) {
    super(`Too many tries. Wait ${Math.ceil(retryAfterSec / 60)} minute${retryAfterSec > 60 ? "s" : ""} and try again.`);
  }
}

/** Count one attempt; throws RateLimited once over the limit. */
export async function hit(rule: RuleName, who: string): Promise<void> {
  const r = RULES[rule];
  const n = await store().incr(keyFor(rule, who), r.windowSec).catch(() => memoryStore.incr(keyFor(rule, who), r.windowSec));
  if (n > r.limit) throw new RateLimited(r.windowSec);
}

/** Is this already over the limit (without counting a new attempt)? */
export async function blocked(rule: RuleName, who: string): Promise<boolean> {
  const n = await store().get(keyFor(rule, who)).catch(() => memoryStore.get(keyFor(rule, who)));
  return n >= RULES[rule].limit;
}

/** Count a failure (no throw). */
export async function fail(rule: RuleName, who: string): Promise<void> {
  await store().incr(keyFor(rule, who), RULES[rule].windowSec).catch(() => memoryStore.incr(keyFor(rule, who), RULES[rule].windowSec));
}

/** A success clears the failure count. */
export async function clear(rule: RuleName, who: string): Promise<void> {
  await store().del(keyFor(rule, who)).catch(() => memoryStore.del(keyFor(rule, who)));
}

/** The visitor's address (first hop of X-Forwarded-For behind a proxy). */
export function clientIp(h: { get(name: string): string | null }): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
