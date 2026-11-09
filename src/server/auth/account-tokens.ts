import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { hashPassword, PASSWORD_MIN } from "./password";

/**
 * One-time links: "forgot password" (30 minutes) and "confirm your email" (3 days). The email
 * gets the random token; the database keeps only its SHA-256, so a database leak can't be used
 * to take over accounts. Every link works once.
 */
export type Purpose = "RESET_PASSWORD" | "VERIFY_EMAIL";
const LIFETIME: Record<Purpose, number> = { RESET_PASSWORD: 30 * 60_000, VERIFY_EMAIL: 3 * 86_400_000 };
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function issueToken(userId: string, purpose: Purpose, now = new Date()) {
  // Only the newest link of each kind works.
  await adminDb.accountToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
  const token = randomBytes(32).toString("base64url");
  await adminDb.accountToken.create({ data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(now.getTime() + LIFETIME[purpose]) } });
  return token;
}

/** The token's row if it's valid right now (not used, not expired, right purpose). */
export async function peekToken(token: string, purpose: Purpose, now = new Date()) {
  if (!token || token.length > 200) return null;
  const t = await adminDb.accountToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt <= now) return null;
  return t;
}

const BAD_LINK = "This link has expired or was already used. Ask for a new one.";

/** Forgot password → new password. Signs the person out everywhere and confirms their email. */
export async function resetPassword(token: string, password: string, now = new Date()) {
  if (password.length < PASSWORD_MIN) throw new UserFacingError(`Use at least ${PASSWORD_MIN} characters`, { password: "Too short" });
  const t = await peekToken(token, "RESET_PASSWORD", now);
  if (!t) throw new UserFacingError(BAD_LINK);
  // Claim the token atomically so two clicks can't both use it.
  const claimed = await adminDb.accountToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: now } });
  if (!claimed.count) throw new UserFacingError(BAD_LINK);
  const user = await adminDb.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password), emailVerified: now } });
  await adminDb.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
  return user;
}

export async function verifyEmail(token: string, now = new Date()) {
  const t = await peekToken(token, "VERIFY_EMAIL", now);
  if (!t) throw new UserFacingError(BAD_LINK);
  await adminDb.accountToken.update({ where: { id: t.id }, data: { usedAt: now } });
  return adminDb.user.update({ where: { id: t.userId }, data: { emailVerified: now } });
}
