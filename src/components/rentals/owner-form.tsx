"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ownerSchema, US_STATES, type OwnerInput } from "@/lib/rentals";
import { createOwner, editOwner } from "@/server/actions/rentals";
import { useCreateModal } from "@/components/create/create-modal";

type Values = {
  kind: "PERSON" | "COMPANY";
  firstName: string; lastName: string; companyName: string; email: string; phone: string;
  addressLine1: string; city: string; state: string; postalCode: string;
  taxIdType: "" | "SSN" | "EIN"; taxIdLast4: string; send1099: boolean;
};

export function OwnerForm({ id, initial, onDone }: { id?: string; initial?: Partial<OwnerInput>; onDone?: () => void }) {
  const router = useRouter();
  const modal = useCreateModal();
  const form = useForm<Values>({
    resolver: zodResolver(ownerSchema) as never,
    defaultValues: {
      kind: "PERSON", firstName: "", lastName: "", companyName: "", email: "", phone: "",
      addressLine1: "", city: "", state: "", postalCode: "", taxIdType: "", taxIdLast4: "", send1099: true,
      ...(initial as Partial<Values>),
    },
  });
  const e = form.formState.errors;
  const kind = form.watch("kind");

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(async (v) => {
        const r = id ? await editOwner(id, v) : await createOwner(v);
        if (!r.ok) {
          for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) form.setError(k as keyof Values, { message: msg });
          return void toast.error(r.error);
        }
        toast.success(id ? "Owner saved" : "Owner created");
        if (onDone) onDone();
        else if (modal) {
          modal.close();
        } else if (!id && r.ok && r.data && typeof r.data === "object" && "id" in r.data) {
          router.push(`/app/people/owners/${(r.data as { id: string }).id}`);
        }
        router.refresh();
      })}
    >
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">Owner type</legend>
        <div className="flex gap-4 text-sm">
          {(["PERSON", "COMPANY"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" value={k} {...form.register("kind")} className="size-4 accent-[var(--primary)]" />
              {k === "PERSON" ? "Individual" : "Company or trust"}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "PERSON" ? (
        <>
          <Field label="First name" description="A first or last name is enough." error={e.firstName?.message}>{(a) => <Input {...a} {...form.register("firstName")} />}</Field>
          <Field label="Last name" error={e.lastName?.message}>{(a) => <Input {...a} {...form.register("lastName")} />}</Field>
        </>
      ) : (
        <Field label="Company name" error={e.companyName?.message} required className="sm:col-span-2">{(a) => <Input {...a} {...form.register("companyName")} />}</Field>
      )}
      <Field label="Email" error={e.email?.message}>{(a) => <Input type="email" {...a} {...form.register("email")} />}</Field>
      <Field label="Phone" error={e.phone?.message}>{(a) => <Input type="tel" {...a} {...form.register("phone")} />}</Field>
      <Field label="Mailing address" className="sm:col-span-2">{(a) => <Input {...a} {...form.register("addressLine1")} />}</Field>
      <Field label="City">{(a) => <Input {...a} {...form.register("city")} />}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="State">
          {(a) => (
            <NativeSelect {...a} {...form.register("state")}>
              <option value="">—</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="ZIP">{(a) => <Input {...a} inputMode="numeric" {...form.register("postalCode")} />}</Field>
      </div>
      <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="px-1 text-[13px] font-medium">Tax info (for 1099s)</legend>
        <Field label="Tax ID type">
          {(a) => (
            <NativeSelect {...a} {...form.register("taxIdType")}>
              <option value="">Not provided</option>
              <option value="SSN">SSN</option>
              <option value="EIN">EIN</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Last 4 digits" description="We never store the full number." error={e.taxIdLast4?.message}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={4} {...form.register("taxIdLast4")} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register("send1099")} />
          Send a 1099
        </label>
      </fieldset>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {modal || onDone ? <Button type="button" variant="secondary" onClick={() => (onDone ? onDone() : modal?.close())}>Cancel</Button> : null}
        <Button type="submit" loading={form.formState.isSubmitting}>{id ? "Save owner" : "Create owner"}</Button>
      </div>
    </form>
  );
}
