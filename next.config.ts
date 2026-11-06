import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs", "nodemailer"],
  typedRoutes: false,
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
