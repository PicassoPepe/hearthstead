"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { companySchema, TIMEZONES, type CompanyInput } from "@/lib/schemas";
import { updateCompany } from "@/server/actions/company";

export function CompanyForm({ defaults, canEdit }: { defaults: CompanyInput; canEdit: boolean }) {
  const router = useRouter();
  const form = useForm<CompanyInput>({ resolver: zodResolver(companySchema), defaultValues: defaults });
  const e = form.formState.errors;
  const color = form.watch("brandColor");

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        const r = await updateCompany(v);
        if (r.ok) {
          toast.success(r.message ?? "Saved");
          form.reset(v);
          router.refresh();
        } else {
          for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) form.setError(k as keyof CompanyInput, { message: msg });
          toast.error(r.error);
        }
      })}
      className="grid gap-4"
    >
      <fieldset disabled={!canEdit} className="grid gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Company</CardTitle>
              <CardDescription>Shown on statements, emails and the resident portal.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" error={e.name?.message} required className="sm:col-span-2">
              {(a) => <Input {...a} {...form.register("name")} />}
            </Field>
            <Field label="Email" error={e.email?.message}>
              {(a) => <Input type="email" {...a} {...form.register("email")} />}
            </Field>
            <Field label="Phone" error={e.phone?.message}>
              {(a) => <Input type="tel" autoComplete="tel" {...a} {...form.register("phone")} />}
            </Field>
            <Field label="Street address" error={e.addressLine1?.message} className="sm:col-span-2">
              {(a) => <Input autoComplete="street-address" {...a} {...form.register("addressLine1")} />}
            </Field>
            <Field label="City" error={e.city?.message}>
              {(a) => <Input autoComplete="address-level2" {...a} {...form.register("city")} />}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" error={e.state?.message}>
                {(a) => <Input autoComplete="address-level1" {...a} {...form.register("state")} />}
              </Field>
              <Field label="ZIP" error={e.postalCode?.message}>
                {(a) => <Input autoComplete="postal-code" inputMode="numeric" {...a} {...form.register("postalCode")} />}
              </Field>
            </div>
            <Field label="Time zone" description="Used for due dates and nightly jobs." error={e.timezone?.message}>
              {(a) => (
                <NativeSelect {...a} {...form.register("timezone")}>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </NativeSelect>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Your color is used in the tenant and owner portals and in emails.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand color" description="6-digit hex, e.g. #0C4C54." error={e.brandColor?.message}>
              {(a) => (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Pick brand color"
                    value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0C4C54"}
                    onChange={(ev) => form.setValue("brandColor", ev.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-input bg-surface"
                  />
                  <Input {...a} {...form.register("brandColor")} className="tabular" />
                </div>
              )}
            </Field>
            <div aria-hidden className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Portal preview</div>
              <div className="mt-2 rounded-md px-3 py-2 text-sm font-semibold text-white" style={{ background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0C4C54" }}>
                Pay rent
              </div>
            </div>
          </CardContent>
          {canEdit ? (
            <CardFooter>
              <Button type="button" variant="secondary" onClick={() => form.reset()} disabled={!form.formState.isDirty}>Discard</Button>
              <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>Save changes</Button>
            </CardFooter>
          ) : null}
        </Card>
      </fieldset>
    </form>
  );
}
