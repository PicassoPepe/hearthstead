"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { newTenantSchema, type NewTenantInput } from "@/lib/leasing";
import { createTenant, updateTenant } from "@/server/actions/leasing";
import { useCreateModal } from "@/components/create/create-modal";

export function TenantForm({ id, initial }: { id?: string; initial?: NewTenantInput }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [v, setV] = React.useState<NewTenantInput>(initial ?? { kind: "PERSON", firstName: "", lastName: "", companyName: "", email: "", phone: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof NewTenantInput, val: string) => setV((p) => ({ ...p, [k]: val }));
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = newTenantSchema.safeParse(v);
        if (!parsed.success) {
          setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
          return;
        }
        setErrors({});
        setBusy(true);
        const r = id ? await updateTenant(id, v) : await createTenant(v);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success(id ? "Tenant saved" : "Tenant created");
        if (modal) modal.close();
        else if (!id && r.data && typeof r.data === "object" && "id" in r.data) router.push(`/app/people/tenants/${(r.data as { id: string }).id}`);
        router.refresh();
      }}
    >
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">Tenant type</legend>
        <div className="flex gap-4 text-sm">
          {(["PERSON", "COMPANY"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="kind" className="size-4 accent-[var(--primary)]" checked={v.kind === k} onChange={() => setV({ ...v, kind: k })} />
              {k === "PERSON" ? "Individual" : "Company"}
            </label>
          ))}
        </div>
      </fieldset>
      {v.kind === "COMPANY" ? (
        <Field label="Company name" error={errors.companyName} required className="sm:col-span-2">{(a) => <Input {...a} value={v.companyName} onChange={(e) => set("companyName", e.target.value)} />}</Field>
      ) : (
        <>
          <Field label="First name" error={errors.firstName} required>{(a) => <Input {...a} value={v.firstName} onChange={(e) => set("firstName", e.target.value)} />}</Field>
          <Field label="Last name" error={errors.lastName} required>{(a) => <Input {...a} value={v.lastName} onChange={(e) => set("lastName", e.target.value)} />}</Field>
        </>
      )}
      <Field label="Email" error={errors.email}>{(a) => <Input {...a} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}</Field>
      <Field label="Phone">{(a) => <Input {...a} type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>{id ? "Save tenant" : "Create tenant"}</Button>
      </div>
    </form>
  );
}
