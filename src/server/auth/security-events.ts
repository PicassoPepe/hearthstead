import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/server/db";

export type SecurityEventKind = "LOGIN_FAILED" | "LOGIN_LOCKED" | "LOGIN_LIMITED" | "SIGNUP_LIMITED" | "MAGIC_LINK_LIMITED" | "TOTP_LIMITED" | "PASSWORD_RESET_REQUESTED" | "PASSWORD_RESET" | "RESET_LIMITED";

/** SHA-256 of the lowercased email, so the log never stores who typed what. */
export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** Record a platform-level security event. Never fails the request that triggered it. */
export async function securityEvent(kind: SecurityEventKind, v: { email?: string | null; userId?: string | null; ip?: string | null; userAgent?: string | null }) {
  await adminDb.securityEvent
    .create({ data: { kind, emailHash: v.email ? emailHash(v.email) : null, userId: v.userId ?? null, ip: v.ip && v.ip !== "local" ? v.ip.slice(0, 64) : null, userAgent: v.userAgent?.slice(0, 300) ?? null } })
    .catch(() => undefined);
}
