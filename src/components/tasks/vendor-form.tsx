"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateModal } from "@/components/create/create-modal";
import { CATEGORIES, type VendorInput } from "@/lib/maintenance";
import { saveVendorAction } from "@/server/actions/maintenance";

export function VendorForm({ id, initial }: { id?: string; initial?: Partial<VendorInput> }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [v, setV] = React.useState<VendorInput>({ name: "", contactName: "", email: "", phone: "", trades: [], taxIdLast4: "", send1099: true, w9OnFile: false, insuranceExpires: "", ...initial });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof VendorInput>(k: K, val: VendorInput[K]) => setV((p) => ({ ...p, [k]: val }));
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await saveVendorAction(id ?? null, v);
        setBusy(false);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          return void toast.error(r.error);
        }
        toast.success(id ? "Vendor saved" : "Vendor created");
        if (modal) modal.close();
        else if (!id) router.push(`/app/people/vendors/${r.data.id}`);
        router.refresh();
      }}
    >
      <Field label="Company name" error={errors.name} required className="sm:col-span-2">{(a) => <Input {...a} value={v.name} onChange={(e) => set("name", e.target.value)} />}</Field>
      <Field label="Contact person">{(a) => <Input {...a} value={v.contactName} onChange={(e) => set("contactName", e.target.value)} />}</Field>
      <Field label="Email" error={errors.email} description="Work orders are emailed here.">{(a) => <Input {...a} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}</Field>
      <Field label="Phone">{(a) => <Input {...a} type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
      <Field label="Insurance expires">{(a) => <Input {...a} type="date" value={v.insuranceExpires} onChange={(e) => set("insuranceExpires", e.target.value)} />}</Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">Trades</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={(v.trades ?? []).includes(c.value)} onChange={(e) => set("trades", e.target.checked ? [...(v.trades ?? []), c.value] : (v.trades ?? []).filter((t) => t !== c.value))} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1 text-[13px] font-medium">Tax & compliance (1099)</legend>
        <Field label="Tax ID — last 4" error={errors.taxIdLast4}>{(a) => <Input {...a} inputMode="numeric" maxLength={4} value={v.taxIdLast4} onChange={(e) => set("taxIdLast4", e.target.value)} />}</Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.w9OnFile} onChange={(e) => set("w9OnFile", e.target.checked)} /> W-9 on file</label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.send1099} onChange={(e) => set("send1099", e.target.checked)} /> Send a 1099</label>
      </fieldset>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>{id ? "Save vendor" : "Create vendor"}</Button>
      </div>
    </form>
  );
}
