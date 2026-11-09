/** Private pages: never in search results (robots.txt and the X-Robots-Tag header say so too). */
export const metadata = { robots: { index: false, follow: false } };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-density min-h-dvh bg-background">{children}</div>;
}
