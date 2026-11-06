import type { NextAuthConfig } from "next-auth";

/** Edge-safe Auth.js config (no Prisma, no bcrypt) — shared by middleware and the server. */
export const authConfig = {
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  providers: [],
  trustHost: true,
  callbacks: {
    authorized({ auth, request }) {
      const p = request.nextUrl.pathname;
      const isProtected = p.startsWith("/app") || p.startsWith("/portal") || p === "/select-org";
      return isProtected ? Boolean(auth?.user) : true;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
