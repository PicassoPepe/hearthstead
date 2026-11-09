"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { resetPasswordAction } from "@/server/actions/auth";

export function ResetForm({ token }: { token: string }) {
  const [v, setV] = React.useState({ password: "", confirm: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  if (done) {
    return (
      <div className="w-full max-w-sm text-center" role="status">
        <CheckCircle2 className="mx-auto mb-3 size-10 text-success" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="mt-2 text-muted-foreground">You&apos;ve been signed out everywhere else. Sign in with your new password.</p>
        <Link href="/login" className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:bg-primary-hover">Sign in</Link>
      </div>
    );
  }
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <form noValidate className="mt-6 grid gap-4" onSubmit={async (e) => {
        e.preventDefault();
        if (v.password !== v.confirm) return setErrors({ confirm: "The two passwords don't match" });
        setBusy(true);
        const r = await resetPasswordAction(token, v.password);
        setBusy(false);
        if (!r.ok) { setErrors({ password: r.fieldErrors?.password ?? "" }); return setFormError(r.fieldErrors?.password ? undefined : r.error); }
        setDone(true);
      }}>
        {formError ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground">{formError} <Link href="/login/forgot" className="font-semibold underline">Get a new link</Link></p> : null}
        <Field label="New password" description="At least 10 characters." required error={errors.password || undefined}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
        <Field label="Type it again" required error={errors.confirm}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />}</Field>
        <Button type="submit" size="lg" loading={busy}>Save new password</Button>
      </form>
    </div>
  );
}
