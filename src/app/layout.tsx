import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";
import { siteUrl } from "@/lib/seo/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "DeedWood", template: "%s · DeedWood" },
  description: "Property management for landlords and property managers.",
  applicationName: "DeedWood",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "DeedWood",
    description: "Property management for landlords and property managers.",
    siteName: "DeedWood",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "DeedWood" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DeedWood",
    description: "Property management for landlords and property managers.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0C4C54" },
    { media: "(prefers-color-scheme: dark)", color: "#0C4C54" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
