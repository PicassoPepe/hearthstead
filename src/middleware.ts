import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/app/:path*", "/portal/:path*", "/admin/:path*", "/admin", "/select-org"],
};
