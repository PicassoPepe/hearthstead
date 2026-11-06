import "server-only";
import NextAuth from "next-auth";
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

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });

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
        return Boolean(existing && !existing.deletedAt);
      }
      return true;
    },
  },
});
