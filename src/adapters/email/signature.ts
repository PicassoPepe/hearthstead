import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string compare. Different lengths never match. */
export function secretsMatch(got: string | null | undefined, expected: string | null | undefined): boolean {
  if (!got || !expected) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resend (Svix) webhook signature. `secret` is the `whsec_…` value from the Resend dashboard.
 * Rejects timestamps more than 5 minutes off so a captured request can't be replayed later.
 */
export function verifyResendSignature(
  payload: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60_000) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try { key = Buffer.from(raw, "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return signature.split(" ").some((part) => {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    return secretsMatch(sig, expected);
  });
}
