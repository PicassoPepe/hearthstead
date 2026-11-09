import Link from "next/link";

export const metadata = { title: "No portal access" };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ paused?: string }> }) {
  const paused = (await searchParams).paused === "1";
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{paused ? "Your portal access is paused" : "No resident portal for this account"}</h1>
      <p className="mt-2 text-muted-foreground">{paused ? "Your property manager has paused your access to the resident portal. Please contact them directly with any questions." : "This email isn’t linked to a lease yet. Ask your property manager to send you a portal invitation."}</p>
      <Link href="/login" className="mt-6 inline-block font-medium text-primary underline">Sign in with a different email</Link>
    </main>
  );
}
