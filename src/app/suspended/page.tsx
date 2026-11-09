import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { signOutAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Account paused" };

/** Shown when DeedWood has paused a company's account. Nothing is deleted. */
export default async function SuspendedPage() {
  const s = await auth();
  if (!s?.user?.id) redirect("/login");
  const m = await adminDb.membership.findFirst({ where: { userId: s.user.id, status: "ACTIVE", deletedAt: null, organization: { suspendedAt: { not: null } } }, include: { organization: true } });
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-card border border-border bg-surface p-6 text-center shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="DeedWood" className="mx-auto mb-4 h-10 w-auto" />
        <h1 className="text-xl font-semibold">{m ? `${m.organization.name}'s account is paused` : "This account is paused"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your data is safe — nothing has been deleted. Please contact DeedWood support to turn the account back on.</p>
        <form action={signOutAction} className="mt-5"><Button type="submit" variant="secondary">Sign out</Button></form>
      </div>
    </main>
  );
}
