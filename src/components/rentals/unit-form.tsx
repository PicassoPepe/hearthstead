"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { addUnit, editUnit } from "@/server/actions/rentals";
import { formatBaths, parseBaths } from "@/lib/rentals";
import { useCreateModal } from "@/components/create/create-modal";

export type UnitFormValues = {
  id?: string;
  propertyId: string;
  name: string;
  beds: number | null;
  bathsTenths: number | null;
  sqft: number | null;
  marketRentCents: number;
  amenities: string[];
};

/** Create (with property picker) or edit a unit. */
export function UnitForm({
  initial,
  properties,
  onDone,
  defaultPropertyId,
}: {
  defaultPropertyId?: string;
  initial?: UnitFormValues;
  properties?: { id: string; name: string; singleUnitFull: boolean }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const modal = useCreateModal();
  const [propertyId, setPropertyId] = React.useState(initial?.propertyId ?? defaultPropertyId ?? "");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [beds, setBeds] = React.useState(initial?.beds?.toString() ?? "");
  const [baths, setBaths] = React.useState(initial?.bathsTenths != null ? formatBaths(initial.bathsTenths) : "");
  const [sqft, setSqft] = React.useState(initial?.sqft?.toString() ?? "");
  const [rent, setRent] = React.useState<number | null>(initial?.marketRentCents ?? null);
  const [amenities, setAmenities] = React.useState((initial?.amenities ?? []).join(", "));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!initial && !propertyId) errs.propertyId = "Choose a property";
    if (!name.trim()) errs.name = "Name the unit";
    const num = (s: string, k: string) => {
      if (s.trim() === "") return null;
      if (!/^\d+$/.test(s.trim())) { errs[k] = "Whole numbers only"; return null; }
      return Number(s);
    };
    const bedsN = num(beds, "beds");
    const sqftN = num(sqft, "sqft");
    const bathsN = baths.trim() === "" ? null : parseBaths(baths);
    if (baths.trim() !== "" && bathsN == null) errs.baths = "Use a number like 1 or 1.5";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const payload = {
      name: name.trim(),
      beds: bedsN,
      bathsTenths: bathsN,
      sqft: sqftN,
      marketRentCents: rent ?? 0,
      amenities: amenities.split(",").map((a) => a.trim()).filter(Boolean),
    };
    const r = initial?.id ? await editUnit(initial.id, payload) : await addUnit(propertyId, payload);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return void toast.error(r.error);
    }
    toast.success(initial?.id ? `${payload.name} saved` : `${payload.name} added`);
    if (onDone) onDone();
    else if (modal) modal.close();
    router.refresh();
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {!initial && properties ? (
        <Field label="Property" error={errors.propertyId} required className="sm:col-span-2">
          {(a) => (
            <NativeSelect {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Choose a property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id} disabled={p.singleUnitFull}>
                  {p.name}{p.singleUnitFull ? " (single-family — already has its unit)" : ""}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Unit name" error={errors.name} required className="sm:col-span-2">
        {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2B" />}
      </Field>
      <Field label="Bedrooms" error={errors.beds}>
        {(a) => <Input {...a} inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} />}
      </Field>
      <Field label="Bathrooms" error={errors.baths}>
        {(a) => <Input {...a} inputMode="decimal" value={baths} onChange={(e) => setBaths(e.target.value)} placeholder="1.5" />}
      </Field>
      <Field label="Square feet" error={errors.sqft}>
        {(a) => <Input {...a} inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} />}
      </Field>
      <Field label="Market rent" error={errors.marketRentCents}>
        {(a) => <MoneyInput {...a} valueCents={rent} onChangeCents={setRent} />}
      </Field>
      <Field label="Amenities" description="Comma-separated, e.g. In-unit laundry, Balcony" className="sm:col-span-2">
        {(a) => <Input {...a} value={amenities} onChange={(e) => setAmenities(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {modal || onDone ? <Button type="button" variant="secondary" onClick={() => (onDone ? onDone() : modal?.close())}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>{initial?.id ? "Save unit" : "Add unit"}</Button>
      </div>
    </form>
  );
}
