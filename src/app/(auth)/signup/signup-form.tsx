"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { Captcha } from "@/components/auth/captcha";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { resendSignupCodeAction, startSignupAction, verifySignupAction, type SignupStart } from "@/server/actions/auth";
import type { OAuthProvider } from "@/server/auth/oauth";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  orgName: z.string().trim().min(2, "Enter your company name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
  phone: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/** Sign-up in two steps: details (+ "I'm human" check) → 6-digit code by email or text. */
export function SignupForm({ captchaSiteKey, oauth, sms }: { captchaSiteKey: string | null; oauth: OAuthProvider[]; sms: boolean }) {
  const [serverError, setServerError] = React.useState<string>();
  const [channel, setChannel] = React.useState<"EMAIL" | "SMS">("EMAIL");
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);
  const [pending, setPending] = React.useState<SignupStart | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", orgName: "", email: "", password: "", phone: "" } });
  const e = form.formState.errors;

  if (pending) return <CodeStep pending={pending} password={form.getValues("password")} onBack={() => { setPending(null); setCaptcha(null); setCaptchaReset((n) => n + 1); }} />;

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Start your free trial</h1>
      <p className="mt-1 text-muted-foreground">Set up your company workspace in about a minute.</p>
      {serverError ? <div role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{serverError}</div> : null}
      {oauth.length ? <div className="mt-6"><OAuthButtons providers={oauth} callbackUrl="/app/overview" verb="Sign up" /></div> : null}
      <Card className="mt-6">
        <CardContent className="pt-5">
          <form noValidate className="grid gap-4" onSubmit={form.handleSubmit(async (v) => {
            setServerError(undefined);
            if (captchaSiteKey && !captcha) return setServerError("Please complete the “I'm human” check.");
            const r = await startSignupAction({ ...v, channel, captcha: captcha ?? undefined });
            if (!r.ok) {
              setServerError(r.error);
              for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) form.setError(k as keyof Values, { message: msg });
              setCaptcha(null);
              setCaptchaReset((n) => n + 1);
              return;
            }
            setPending(r.data);
          })}>
            <Field label="Your name" error={e.name?.message} required>{(a) => <Input autoComplete="name" {...a} {...form.register("name")} />}</Field>
            <Field label="Company name" error={e.orgName?.message} required>{(a) => <Input autoComplete="organization" {...a} {...form.register("orgName")} />}</Field>
            <Field label="Work email" error={e.email?.message} required>{(a) => <Input type="email" autoComplete="email" {...a} {...form.register("email")} />}</Field>
            <Field label="Password" description="At least 10 characters." error={e.password?.message} required>{(a) => <Input type="password" autoComplete="new-password" {...a} {...form.register("password")} />}</Field>
            {sms ? (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Send my sign-up code by</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([["EMAIL", "Email", Mail], ["SMS", "Text message", MessageSquareText]] as const).map(([v, label, Icon]) => (
                    <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring", channel === v ? "border-primary bg-primary-soft/50 font-medium" : "border-border")}>
                      <input type="radio" name="channel" value={v} checked={channel === v} onChange={() => setChannel(v)} className="sr-only" />
                      <Icon className="size-4" aria-hidden />{label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {channel === "SMS" ? <Field label="Mobile number" error={e.phone?.message} required>{(a) => <Input type="tel" autoComplete="tel" inputMode="tel" placeholder="(555) 555-5555" {...a} {...form.register("phone")} />}</Field> : null}
            <Captcha siteKey={captchaSiteKey} onToken={setCaptcha} resetKey={captchaReset} />
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Continue</Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link></p>
    </div>
  );
}

function CodeStep({ pending, password, onBack }: { pending: SignupStart; password: string; onBack: () => void }) {
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [testCode, setTestCode] = React.useState(pending.testCode);
  const [note, setNote] = React.useState<string>();
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
      <p className="mt-1 text-muted-foreground">We {pending.channel === "SMS" ? "texted" : "emailed"} a 6-digit code to <strong className="text-foreground">{pending.sentTo}</strong>. It expires in 15 minutes.</p>
      {testCode ? <p className="mt-3 rounded-lg border border-info/40 bg-info-soft px-3 py-2 text-sm text-info-soft-foreground" data-testid="test-code">Test mode (no real texts are sent): your code is <strong>{testCode}</strong>.</p> : null}
      {note ? <p role="status" className="mt-3 text-sm text-success">{note}</p> : null}
      <Card className="mt-6">
        <CardContent className="pt-5">
          <form noValidate className="grid gap-4" onSubmit={async (ev) => {
            ev.preventDefault();
            setBusy(true);
            setError(undefined);
            const r = await verifySignupAction(pending.pendingId, code, password);
            setBusy(false);
            if (r && !r.ok) setError(r.error);
          }}>
            <Field label="6-digit code" error={error} required>{(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="text-center text-2xl tracking-[0.4em]" autoFocus />}</Field>
            <Button type="submit" size="lg" loading={busy}>Create my workspace</Button>
          </form>
        </CardContent>
      </Card>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={async () => {
          const r = await resendSignupCodeAction(pending.pendingId);
          if (!r.ok) return setError(r.error);
          setTestCode(r.data.testCode);
          setNote("We sent a new code.");
        }}>Send a new code</button>
        <button type="button" className="font-medium text-muted-foreground underline-offset-4 hover:underline" onClick={onBack}>Change my details</button>
      </div>
    </div>
  );
}
