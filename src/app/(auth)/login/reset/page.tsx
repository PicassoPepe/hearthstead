import Link from "next/link";
import { peekToken } from "@/server/auth/account-tokens";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = Boolean(await peekToken(token, "RESET_PASSWORD"));
  if (!valid) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-2 text-muted-foreground">Password links work once and only for 30 minutes.</p>
        <Link href="/login/forgot" className="mt-6 inline-block font-medium text-primary underline-offset-4 hover:underline">Send me a new link</Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}
