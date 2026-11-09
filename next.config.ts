import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The website export ("Make Website Folder") builds into its own folder so it never replaces the app's build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
      // Private areas: never in search results (belt and braces with robots.txt).
      ...["/app/:path*", "/portal/:path*", "/admin/:path*", "/admin", "/sign/:path*", "/api/:path*", "/dev/:path*", "/login", "/signup", "/select-org", "/apply/:path*"].map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
    ];
  },
};

export default nextConfig;
