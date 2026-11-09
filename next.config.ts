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
    const dev = process.env.NODE_ENV !== "production";
    return [
      // Company websites may appear in the staff editor's preview (same site only) and load Plausible.
      { source: "/s/:path*", headers: securityHeaders(dev, true) },
      { source: "/:path((?!s/).*)", headers: securityHeaders(dev) },
    ];
  },
};

export default nextConfig;
