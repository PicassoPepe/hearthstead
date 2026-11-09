import { createHmac, timingSafeEqual } from "node:crypto";
import { UserFacingError } from "@/server/action-result";

/**
 * Stripe Billing (DeedWood charging its subscribers) — REST, no SDK, test keys until going live
 * is approved (scripts/check-env.mjs refuses a live key otherwise). Separate from Stripe Connect,
 * which moves tenants' rent to landlords (src/adapters/payments/stripe.ts).
 */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
export function setStripeFetcher(f: Fetcher) { fetcher = f; }

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_"));

/** Stripe's form encoding, with nested keys like line_items[0][price]. */
export function formEncode(o: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? out.push(...formEncode(x as Record<string, unknown>, `${key}[${i}]`)) : out.push([`${key}[${i}]`, String(x)])));
    else if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push([key, String(v)]);
  }
  return out;
}

export async function stripe<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe isn't set up (STRIPE_SECRET_KEY)");
  const qs = method === "GET" && body ? `?${new URLSearchParams(formEncode(body))}` : "";
  const res = await fetcher(`https://api.stripe.com/v1${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: method === "POST" && body ? new URLSearchParams(formEncode(body)).toString() : undefined,
  }).catch(() => { throw new UserFacingError("The payment service didn't answer. Try again in a minute."); });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok) throw new UserFacingError(`The payment service said: ${json.error?.message ?? `error ${res.status}`}`);
  return json;
}

/** Verify a webhook's Stripe-Signature header (HMAC-SHA256 of "t.payload", 5-minute tolerance). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
