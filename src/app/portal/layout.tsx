import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";

/** Private pages: never in search results (robots.txt and the X-Robots-Tag header say so too). */
export const metadata = { robots: { index: false, follow: false } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user?.id) {
    const u = await adminDb.user.findUnique({ where: { id: session.user.id }, select: { mustChangePassword: true } });
    if (u?.mustChangePassword) redirect("/app/overview");
  }
  return <div className="portal-density min-h-dvh bg-background">{children}</div>;
}
