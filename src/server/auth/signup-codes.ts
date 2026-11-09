import { createHash, randomInt } from "node:crypto";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";

/**
 * First-time sign-up is confirmed with a 6-digit code sent by email or text message. The code
 * is stored only as a hash, lasts 15 minutes, allows 5 tries, and can be re-sent 3 times.
 */
export const CODE_MINUTES = 15;
export const MAX_TRIES = 5;
export const MAX_SENDS = 4;
const hashCode = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export type SignupPayload = { name: string; orgName: string; passwordHash: string };

export async function createPending(v: { email: string; channel: "EMAIL" | "SMS"; phone: string | null; payload: SignupPayload }, now = new Date()) {
  // One pending sign-up per email at a time.
  await adminDb.pendingSignup.deleteMany({ where: { email: v.email } });
  const code = newCode();
  const p = await adminDb.pendingSignup.create({ data: { email: v.email, channel: v.channel, phone: v.phone, payload: v.payload, codeHash: "x", expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) } });
  await adminDb.pendingSignup.update({ where: { id: p.id }, data: { codeHash: hashCode(p.id, code) } });
  return { id: p.id, code };
}

export async function newCodeFor(id: string, now = new Date()) {
  const p = await adminDb.pendingSignup.findUnique({ where: { id } });
  if (!p) throw new UserFacingError("Start again — this sign-up has expired.");
  if (p.sends >= MAX_SENDS) throw new UserFacingError("We've sent the code a few times already. Start again in a little while.");
  const code = newCode();
  await adminDb.pendingSignup.update({ where: { id }, data: { codeHash: hashCode(id, code), sends: { increment: 1 }, attempts: 0, expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000) } });
  return { pending: p, code };
}

/** Check a code. Returns the pending sign-up (and deletes it) when right; throws a friendly error otherwise. */
export async function checkCode(id: string, code: string, now = new Date()) {
  const p = await adminDb.pendingSignup.findUnique({ where: { id } });
  if (!p || p.expiresAt <= now) throw new UserFacingError("This code has expired. Press “Send a new code”.", { code: "Expired" });
  if (p.attempts >= MAX_TRIES) throw new UserFacingError("Too many wrong codes. Press “Send a new code”.", { code: "Too many tries" });
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6 || hashCode(p.id, clean) !== p.codeHash) {
    await adminDb.pendingSignup.update({ where: { id }, data: { attempts: { increment: 1 } } });
    const left = MAX_TRIES - p.attempts - 1;
    throw new UserFacingError(left > 0 ? `That code isn't right. ${left} tr${left === 1 ? "y" : "ies"} left.` : "Too many wrong codes. Press “Send a new code”.", { code: "Wrong code" });
  }
  // Claim it (two submits can't both create an account).
  const del = await adminDb.pendingSignup.deleteMany({ where: { id, codeHash: p.codeHash } });
  if (!del.count) throw new UserFacingError("This code was already used.", { code: "Used" });
  return p;
}

export const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"•".repeat(Math.min(6, b.length))}${c}`);
export const maskPhone = (p: string) => `•••-•••-${p.slice(-4)}`;
