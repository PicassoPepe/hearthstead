"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { changeRequiredPasswordAction } from "@/server/actions/auth";

/** Shown by the staff app layout until a temporary password is replaced. */
export function ChangePasswordScreen() {
  const router = useRouter();
  const [v, setV] = React.useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Choose your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">This account was created for you with a temporary password. Choose your own before you continue. Nothing else is available until you do.</p>
      <form noValidate className="mt-6 grid gap-4" onSubmit={async (e) => {
        e.preventDefault();
        setFormError(undefined);
        if (v.next !== v.confirm) { setErrors({ confirm: "The two passwords don't match" }); return; }
        setBusy(true);
        const r = await changeRequiredPasswordAction(v.current, v.next);
        setBusy(false);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); setFormError(r.fieldErrors?.current || r.fieldErrors?.next ? undefined : r.error); return; }
        router.replace("/app/overview");
        router.refresh();
      }}>
        {formError ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground">{formError}</p> : null}
        <Field label="Temporary password" required error={errors.current}>{(a) => <Input {...a} type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />}</Field>
        <Field label="New password" description="At least 10 characters." required error={errors.next}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />}</Field>
        <Field label="New password again" required error={errors.confirm}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />}</Field>
        <Button type="submit" loading={busy}>Save password</Button>
      </form>
    </div>
  );
}
