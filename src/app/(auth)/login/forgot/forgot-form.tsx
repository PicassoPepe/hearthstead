"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { requestPasswordResetAction } from "@/server/actions/auth";
import { Captcha } from "@/components/auth/captcha";

export function ForgotForm({ mock, captchaSiteKey }: { mock: boolean; captchaSiteKey: string | null }) {
  const [email, setEmail] = React.useState("");
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  if (sent) {
    return (
      <div className="w-full max-w-sm text-center" role="status">
        <div aria-hidden className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground"><MailCheck className="size-6" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-muted-foreground">If an account exists for <strong className="text-foreground">{email}</strong>, we sent a link to choose a new password. It works once and expires in 30 minutes.</p>
        {mock ? <p className="mt-6 rounded-lg border border-info/40 bg-info-soft px-3 py-2 text-sm text-info-soft-foreground">Test mode: emails are kept in the <Link href="/dev/outbox" className="font-semibold underline">outbox</Link>.</p> : null}
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1 text-muted-foreground">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <form noValidate className="mt-6 grid gap-4" onSubmit={async (e) => {
        e.preventDefault();
        if (captchaSiteKey && !captcha) return setError("Please complete the “I'm human” check.");
        setBusy(true);
        const r = await requestPasswordResetAction({ email, captcha: captcha ?? undefined });
        setBusy(false);
        if (!r.ok) { setCaptcha(null); setCaptchaReset((n) => n + 1); return setError(r.error); }
        setSent(true);
      }}>
        <Field label="Email" required error={error}>{(a) => <Input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Captcha siteKey={captchaSiteKey} onToken={setCaptcha} resetKey={captchaReset} />
        <Button type="submit" size="lg" loading={busy}>Send me a link</Button>
      </form>
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>
    </div>
  );
}
