"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { createCompanyForSomeoneAction } from "@/server/actions/admin";

/** Platform owner creates a landlord company without access to their email or phone. */
export function CreateCompanyForm() {
  const router = useRouter();
  const [v, setV] = React.useState({ ownerName: "", email: "", companyName: "", password: "", freeBeta: false, reason: "", until: "", emailWelcome: false, code: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<{ email: string; temporaryPassword: string } | null>(null);
  const set = (patch: Partial<typeof v>) => setV((cur) => ({ ...cur, ...patch }));

  if (created) {
    return (
      <div className="grid gap-3 rounded-card border border-border bg-surface p-5 shadow-card" role="status" data-testid="created-company">
        <h2 className="font-display text-[15px] font-semibold">Company created</h2>
        <p className="text-sm text-muted-foreground">Give this temporary password to {created.email} now. It is not saved anywhere you can open later, and no email was sent unless you checked that box. They must choose their own password the first time they sign in.</p>
        <p className="rounded-lg bg-surface-muted p-3 font-mono text-sm" data-testid="temp-password">{created.temporaryPassword}</p>
        <div><Button type="button" variant="secondary" onClick={() => { setCreated(null); router.refresh(); }}>Create another</Button></div>
      </div>
    );
  }

  return (
    <form className="grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card" noValidate data-testid="create-company" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await createCompanyForSomeoneAction({
        ownerName: v.ownerName,
        email: v.email,
        companyName: v.companyName,
        password: v.password,
        freeBeta: v.freeBeta,
        reason: v.reason,
        until: v.freeBeta && v.until ? v.until : null,
        emailWelcome: v.emailWelcome,
        code: v.code,
      });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
      setErrors({});
      setCreated({ email: r.data.email, temporaryPassword: r.data.temporaryPassword });
      setV({ ownerName: "", email: "", companyName: "", password: "", freeBeta: false, reason: "", until: "", emailWelcome: false, code: "" });
      toast.success(r.message ?? "Company created");
    }}>
      <div>
        <h2 className="font-display text-[15px] font-semibold">Create company for someone</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">For a beta landlord when you can&apos;t receive their email or text code. Their email is not marked confirmed. They sign in with the temporary password and must choose a new one.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Owner name" required error={errors.ownerName}>{(a) => <Input {...a} autoComplete="name" value={v.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />}</Field>
        <Field label="Email" required error={errors.email}>{(a) => <Input {...a} type="email" autoComplete="off" value={v.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        <Field label="Company name" required error={errors.companyName}>{(a) => <Input {...a} value={v.companyName} onChange={(e) => set({ companyName: e.target.value })} />}</Field>
        <Field label="Temporary password" error={errors.password} description="Leave blank to generate a strong one. It is shown once.">{(a) => <Input {...a} type="text" autoComplete="off" value={v.password} onChange={(e) => set({ password: e.target.value })} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.freeBeta} onChange={(e) => set({ freeBeta: e.target.checked })} /> Free beta (no card)</label>
      {v.freeBeta ? <Field label="Free until" error={errors.until} description="Optional. Leave blank for no end date.">{(a) => <Input {...a} type="date" value={v.until} onChange={(e) => set({ until: e.target.value })} className="w-48" />}</Field> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.emailWelcome} onChange={(e) => set({ emailWelcome: e.target.checked })} /> Email them a welcome and sign-in link</label>
      <Field label="Reason" required error={errors.reason} description="Why are you creating this company? At least 5 characters. Saved in the owner-console audit log.">{(a) => <Textarea {...a} rows={2} value={v.reason} onChange={(e) => set({ reason: e.target.value })} />}</Field>
      <Field label="Two-factor code" required error={errors.code} description="The current 6-digit code from your authenticator app.">{(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" className="w-40" value={v.code} onChange={(e) => set({ code: e.target.value })} />}</Field>
      <div><Button type="submit" loading={busy}>Create company</Button></div>
    </form>
  );
}
