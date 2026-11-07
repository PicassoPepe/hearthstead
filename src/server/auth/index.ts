import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { verifyTotp } from "@/server/platform/totp";
import Credentials from "next-auth/providers/credentials";
import type { EmailConfig } from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { adminDb } from "@/server/db";
import { getEmailProvider } from "@/adapters";
import { authConfig } from "./config";
import { verifyPassword } from "./password";
import { magicLinkEmail } from "@/server/emails";

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

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** TOTP code, or a one-time recovery code (consumed on use). */
async function checkSecondFactor(user: { id: string; totpSecret: string | null; recoveryCodeHashes: string[] }, code: string | undefined) {
  if (!code) throw new TwoFactorRequired();
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
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await adminDb.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash);
        if (!user || !ok || user.deletedAt) return null;
        if (user.twoFactorEnabled) await checkSecondFactor(user, parsed.data.code);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    magicLink,
  ],
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
