import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer", "embedded-postgres"],
  typedRoutes: false,
  devIndicators: false,
  // `pnpm lint` and `pnpm typecheck` run separately; skipping them here keeps one-click builds quick and quiet.
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
