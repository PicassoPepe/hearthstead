import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The website export ("Make Website Folder") builds into its own folder so it never replaces the app's build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Native add-ons must stay out of the Worker bundle. The desktop `next start` still loads them
  // from node_modules. Prisma's query-engine binary is unused on Workers (driver adapters) and is
  // excluded from the file trace below so it does not blow the Worker size limit.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bcryptjs", "nodemailer", "embedded-postgres", "sharp", "bullmq", "playwright", "ioredis"],
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/@prisma/engines/**",
      "./node_modules/.prisma/client/libquery_engine-*",
      "./node_modules/prisma/**",
      "./node_modules/@embedded-postgres/**",
      "./node_modules/embedded-postgres/**",
      "./node_modules/sharp/**",
      "./node_modules/@img/**",
      "./node_modules/playwright*/**",
      "./node_modules/bullmq/**",
    ],
  },
  // No next/image usage. Skipping the optimizer keeps native sharp out of the Worker.
  images: { unoptimized: true },
  env: { DEEDWOOD_GIT_SHA: process.env.DEEDWOOD_GIT_SHA ?? "" },
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

// Desktop and tests never need this. Set DEEDWOOD_CF_DEV=1 only when previewing Workers bindings.
if (process.env.DEEDWOOD_CF_DEV === "1") {
  void import("@opennextjs/cloudflare")
    .then((m) => m.initOpenNextCloudflareForDev())
    .catch((e: unknown) => {
      console.warn("[deedwood] Cloudflare dev bindings didn't start:", e instanceof Error ? e.message : e);
    });
}
