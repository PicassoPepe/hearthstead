"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { submitOwnerRequest } from "@/server/actions/owner-portal";

export function OwnerRequestForm({ properties }: { properties: { id: string; name: string }[] }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = React.useState(properties[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <form noValidate className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await submitOwnerRequest({ propertyId, title, description: description || undefined });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success(`Request #${r.data.number} sent`);
      setTitle(""); setDescription(""); setErrors({});
      router.refresh();
    }}>
      <Field label="Property" required error={errors.propertyId}>{(a) => <NativeSelect {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
      <Field label="What do you need?" required error={errors.title}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Quote to replace the roof" />}</Field>
      <Field label="Details" error={errors.description}>{(a) => <Textarea {...a} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Button type="submit" className="justify-self-start" loading={busy}>Send request</Button>
    </form>
  );
}
