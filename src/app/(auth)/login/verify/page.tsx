import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { verifyEmail } from "@/server/auth/account-tokens";

export const metadata = { title: "Confirm your email", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const ok = await verifyEmail(token).then(() => true).catch(() => false);
  return (
    <div className="w-full max-w-sm text-center" role="status">
      {ok ? <CheckCircle2 className="mx-auto mb-3 size-10 text-success" aria-hidden /> : null}
      <h1 className="text-2xl font-semibold tracking-tight">{ok ? "Email confirmed — thank you!" : "This link has expired"}</h1>
      <p className="mt-2 text-muted-foreground">{ok ? "You're all set." : "Confirmation links last 3 days and work once. Sign in and use “Send it again” on the yellow note at the top of the page."}</p>
      <Link href="/app/overview" className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:bg-primary-hover">Go to DeedWood</Link>
    </div>
  );
}
