import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer", "embedded-postgres"],
  typedRoutes: false,
  devIndicators: false,
  // `pnpm lint` and `pnpm typecheck` run separately; skipping them here keeps one-click builds quick and quiet.
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") }];
  },
};

export default nextConfig;
