export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-density min-h-dvh bg-background">{children}</div>;
}
