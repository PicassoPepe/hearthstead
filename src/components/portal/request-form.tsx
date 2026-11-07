"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CATEGORIES } from "@/lib/maintenance";
import { submitRequest } from "@/server/actions/portal";

export function RequestForm() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [photos, setPhotos] = React.useState<string[]>([]);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await submitRequest(new FormData(e.currentTarget));
        setBusy(false);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          return void toast.error(r.error);
        }
        toast.success(`Request #${r.data.number} submitted`);
        router.push(`/portal/tenant/requests/${r.data.id}`);
      }}
    >
      <Card className="grid gap-4 p-4">
        <Field label="What needs fixing?" error={errors.category} required>
          {(a) => (
            <NativeSelect {...a} name="category" defaultValue="">
              <option value="" disabled>Choose a category</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Short summary" error={errors.title} required>{(a) => <Input {...a} name="title" placeholder="e.g. Bathroom sink is leaking" />}</Field>
        <Field label="Details" description="Where is it, when did it start, anything you've tried?">{(a) => <Textarea {...a} name="description" />}</Field>
        <Field label="Photos" description="Up to 6 photos help us bring the right parts.">
          {(a) => (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-strong p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-ring">
              <Camera className="size-5 text-muted-foreground" aria-hidden />
              <span>{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} selected` : "Add photos"}</span>
              <input {...a} type="file" name="photos" accept="image/*" multiple className="sr-only" onChange={(e) => setPhotos([...(e.target.files ?? [])].map((f) => f.name))} />
            </label>
          )}
        </Field>
      </Card>
      <Card className="grid gap-4 p-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">May we enter if you&apos;re not home? <span className="text-danger" aria-hidden>*</span></legend>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="permissionToEnter" value="yes" className="size-5 accent-[var(--primary)]" /> Yes, you may enter</label>
            <label className="flex items-center gap-2"><input type="radio" name="permissionToEnter" value="no" className="size-5 accent-[var(--primary)]" /> No, please schedule with me first</label>
          </div>
          {errors.permissionToEnter ? <p role="alert" className="mt-1 text-xs font-medium text-danger">{errors.permissionToEnter}</p> : null}
        </fieldset>
        <Field label="Best times to reach you or come by">{(a) => <Input {...a} name="preferredTimes" placeholder="e.g. Weekdays after 5pm" />}</Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="urgent" className="mt-0.5 size-5 accent-[var(--primary)]" />
          <span><span className="font-medium">This is urgent</span><span className="block text-muted-foreground">Active leak, no heat, no hot water, or a safety issue. For fire or gas smells, call 911 first.</span></span>
        </label>
      </Card>
      <Button type="submit" size="lg" loading={busy}>Submit request</Button>
    </form>
  );
}
