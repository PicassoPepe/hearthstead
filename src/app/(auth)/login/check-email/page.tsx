import Link from "next/link";
import { MailCheck } from "lucide-react";

export const metadata = { title: "Check your email" };

export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  const mock = (process.env.EMAIL_PROVIDER ?? "mock") === "mock" && process.env.NODE_ENV !== "production";
  return (
    <div className="w-full max-w-sm text-center">
      <div aria-hidden className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <MailCheck className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-2 text-muted-foreground">
        If an account exists for {email ? <strong className="text-foreground">{email}</strong> : "that address"}, we sent a sign-in link. It expires in 15 minutes.
      </p>
      {mock ? (
        <p className="mt-6 rounded-lg border border-info/40 bg-info-soft px-3 py-2 text-sm text-info-soft-foreground">
          Dev mode: emails are captured by the mock provider.{" "}
          <Link href="/dev/outbox" className="font-semibold underline">Open the outbox</Link>
        </p>
      ) : null}
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>
    </div>
  );
}
