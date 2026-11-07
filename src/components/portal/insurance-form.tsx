"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { uploadInsurance } from "@/server/actions/portal";

export function InsuranceForm({ readOnly }: { readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const form = e.currentTarget;
        const r = await uploadInsurance(new FormData(form));
        setBusy(false);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
        toast.success("Proof of insurance submitted");
        form.reset();
        router.refresh();
      }}
    >
      <Field label="Insurance company" error={errors.carrier} required>{(a) => <Input {...a} name="carrier" />}</Field>
      <Field label="Policy number" error={errors.policyNumber} required>{(a) => <Input {...a} name="policyNumber" />}</Field>
      <Field label="Starts" error={errors.effectiveDate} required>{(a) => <Input {...a} type="date" name="effectiveDate" />}</Field>
      <Field label="Ends" error={errors.expiresOn} required>{(a) => <Input {...a} type="date" name="expiresOn" />}</Field>
      <Field label="Liability coverage" description="e.g. 100,000">{(a) => <Input {...a} name="liability" inputMode="decimal" />}</Field>
      <Field label="Declarations page (PDF or photo)">{(a) => <Input {...a} type="file" name="file" accept="application/pdf,image/*" className="py-1.5" />}</Field>
      <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={readOnly}>Submit proof of insurance</Button></div>
    </form>
  );
}
