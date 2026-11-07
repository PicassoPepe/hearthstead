"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { requestShowingAction } from "@/server/actions/public";

/** Self-scheduled showing: pick one of the next week's open slots. */
export function RequestShowing({ orgSlug, slug, slots }: { orgSlug: string; slug: string; slots: { iso: string; label: string }[] }) {
  const [f, setF] = React.useState({ firstName: "", lastName: "", email: "", phone: "", startsAt: slots[0]?.iso ?? "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  if (done) return <p role="status" className="rounded-lg bg-success-soft p-3 text-sm text-success-soft-foreground">You&apos;re booked for {done}. The office will confirm by email or text.</p>;
  return (
    <form noValidate className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await requestShowingAction(orgSlug, slug, f);
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      setDone(slots.find((s) => s.iso === f.startsAt)?.label ?? "your time");
    }}>
      <Field label="Time" required error={errors.startsAt}>{(a) => <NativeSelect {...a} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })}>{slots.map((s) => <option key={s.iso} value={s.iso}>{s.label}</option>)}</NativeSelect>}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required error={errors.firstName}>{(a) => <Input {...a} autoComplete="given-name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />}</Field>
        <Field label="Last name" required error={errors.lastName}>{(a) => <Input {...a} autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />}</Field>
      </div>
      <Field label="Email" required error={errors.email}>{(a) => <Input {...a} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      <Field label="Phone">{(a) => <Input {...a} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      <Button type="submit" loading={busy}>Book showing</Button>
    </form>
  );
}
