import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { verifyTotp } from "@/server/platform/totp";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { EmailConfig } from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { adminDb } from "@/server/db";
import { getEmailProvider } from "@/adapters";
import { authConfig } from "./config";
import { verifyPassword } from "./password";
import { magicLinkEmail } from "@/server/emails";
import * as RL from "./rate-limit";
import { clientIp } from "./rate-limit";
import { securityEvent } from "./security-events";

// Our Prisma model is `AuthAccount` (because `Account` is the chart of accounts), so map the
// adapter's `account` delegate onto it.
const adapterDb = new Proxy(adminDb, {
  get(target, prop, receiver) {
    if (prop === "account") return target.authAccount;
    return Reflect.get(target, prop, receiver) as unknown;
  },
}) as PrismaClient;

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1), code: z.string().max(20).optional() });

/** Password was right but a 2FA code is needed (or was wrong). */
export class TwoFactorRequired extends CredentialsSignin {
  override code = "2fa_required";
}
export class TwoFactorInvalid extends CredentialsSignin {
  override code = "2fa_invalid";
}
/** Too many wrong passwords/codes for this account: locked for a while. */
export class AccountLocked extends CredentialsSignin {
  override code = "locked";
}
/** Too many sign-in attempts from this address. */
export class TooManyAttempts extends CredentialsSignin {
  override code = "rate_limited";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** TOTP code, or a one-time recovery code (consumed on use). */
async function checkSecondFactor(user: { id: string; totpSecret: string | null; recoveryCodeHashes: string[] }, code: string | undefined) {
  if (!code || code === "undefined") throw new TwoFactorRequired();
  if (user.totpSecret && verifyTotp(user.totpSecret, code)) return;
  const h = sha(code.trim().toLowerCase());
  if (user.recoveryCodeHashes.includes(h)) {
    await adminDb.user.update({ where: { id: user.id }, data: { recoveryCodeHashes: user.recoveryCodeHashes.filter((x) => x !== h) } });
    return;
  }
  throw new TwoFactorInvalid();
}

/** Sessions are checked against the UserSession table at most once a minute per process. */
const sessionChecks = new Map<string, number>();

const magicLink: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: 15 * 60,
  async sendVerificationRequest({ identifier, url }) {
    const { subject, html, text } = magicLinkEmail(url);
    await getEmailProvider().send({ to: identifier, subject, html, text });
  },
  options: {},
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(adapterDb),
  providers: [
    Credentials({
      id: "password",
      name: "Password",
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const ip = clientIp(request.headers);
        const userAgent = request.headers.get("user-agent");
        // Per-address limit (only when we know the address — e.g. behind the hosting proxy).
        if (ip !== "local") {
          try {
            await RL.hit("loginIp", ip);
          } catch {
            await securityEvent("LOGIN_LIMITED", { email, ip, userAgent });
            throw new TooManyAttempts();
          }
        }
        // Per-account lockout after repeated wrong passwords or codes.
        if (await RL.blocked("loginFailEmail", email)) {
          await securityEvent("LOGIN_LOCKED", { email, ip, userAgent });
          throw new AccountLocked();
        }
        const user = await adminDb.user.findUnique({ where: { email } });
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash);
        if (!user || !ok || user.deletedAt) {
          await RL.fail("loginFailEmail", email);
          await securityEvent("LOGIN_FAILED", { email, userId: user?.id, ip, userAgent });
          return null;
        }
        if (user.twoFactorEnabled) {
          try {
            await checkSecondFactor(user, parsed.data.code);
          } catch (e) {
            if (e instanceof TwoFactorInvalid) {
              await RL.fail("loginFailEmail", email);
              await securityEvent("LOGIN_FAILED", { email, userId: user.id, ip, userAgent });
            }
            throw e;
          }
        }
        await RL.clear("loginFailEmail", email);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    magicLink,
    // "Sign in with …" — only when keys are set. Google confirms emails, so it may sign in to an
    // existing account with the same email; Microsoft only creates new accounts.
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ? [MicrosoftEntraID({ issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "https://login.microsoftonline.com/common/v2.0" })] : []),
  ],
  events: {
    // Google has already confirmed the email address.
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.id) await adminDb.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } });
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Magic links only work for people who already have an account (invited or signed up).
      if (account?.provider === "email") {
        const email = user.email?.toLowerCase();
        if (!email) return false;
        const existing = await adminDb.user.findUnique({ where: { email } });
        // Email links don't satisfy two-factor: those accounts sign in with password + code.
        if (existing?.twoFactorEnabled) return "/login?error=2fa_password";
        return Boolean(existing && !existing.deletedAt);
      }
      if (account?.provider === "google" || account?.provider === "microsoft-entra-id") {
        const email = user.email?.toLowerCase();
        if (!email) return false;
        const existing = await adminDb.user.findUnique({ where: { email } });
        // Two-factor accounts always sign in with password + code.
        if (existing?.twoFactorEnabled) return "/login?error=2fa_password";
        if (existing?.deletedAt) return false;
        return true;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        // New sign-in: record a session the user can see and revoke in Settings → Security.
        let ua: string | null = null;
        let ip: string | null = null;
        try {
          const h = await headers();
          ua = h.get("user-agent");
          ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        } catch {
          /* not in a request scope */
        }
        const s = await adminDb.userSession.create({ data: { userId: user.id, userAgent: ua?.slice(0, 300) ?? null, ip } });
        token.sid = s.id;
        return token;
      }
      const sid = token.sid as string | undefined;
      if (sid) {
        const last = sessionChecks.get(sid) ?? 0;
        if (Date.now() - last > 60_000) {
          const s = await adminDb.userSession.findUnique({ where: { id: sid } });
          if (!s || s.revokedAt) return null;
          sessionChecks.set(sid, Date.now());
          await adminDb.userSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      (session as { sid?: string }).sid = token.sid as string | undefined;
      return session;
    },
  },
});
