"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, X } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCreateModal } from "@/components/create/create-modal";
import { CATEGORIES } from "@/lib/maintenance";
import { createTaskAction } from "@/server/actions/maintenance";
import { uploadFiles } from "@/server/actions/records";
import type { TaskFormOptions } from "@/server/maintenance/queries";
import { cn } from "@/lib/utils";

const URGENCY = [
  { value: "URGENT", label: "Emergency", hint: "Water leak, no heat, gas smell, locked out" },
  { value: "HIGH", label: "Soon", hint: "In the next day or two" },
  { value: "NORMAL", label: "When you can", hint: "Within a week or so" },
] as const;

/**
 * "Report a repair" — the simple way to log maintenance: which home, what's wrong, how urgent,
 * photos, and (optionally) who should fix it. Creates a repair (task, or a work order when a
 * repair company is chosen) and attaches the photos.
 */
export function RepairForm({ options, preset = {} }: { options: TaskFormOptions; preset?: { propertyId?: string; unitId?: string } }) {
  const router = useRouter();
  const modal = useCreateModal();
  const presetProp = preset.propertyId ?? options.properties.find((p) => p.units.some((u) => u.id === preset.unitId))?.id ?? (options.properties.length === 1 ? options.properties[0]!.id : "");
  const [propertyId, setPropertyId] = React.useState(presetProp);
  const [unitId, setUnitId] = React.useState(preset.unitId ?? "");
  const [title, setTitle] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [urgency, setUrgency] = React.useState<(typeof URGENCY)[number]["value"]>("NORMAL");
  const [category, setCategory] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const property = options.properties.find((p) => p.id === propertyId);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const previews = React.useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  React.useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <form noValidate className="grid gap-5" onSubmit={async (e) => {
      e.preventDefault();
      const errs: Record<string, string> = {};
      if (title.trim().length < 3) errs.title = "Say what's wrong in a few words";
      if (Object.keys(errs).length) return setErrors(errs);
      setBusy(true);
      const r = await createTaskAction({
        type: vendorId ? "WORK_ORDER" : "TASK", title, description: details, category: category || null, priority: urgency, dueDate: "",
        propertyId: propertyId || null, unitId: unitId || null, leaseId: null, vendorId: vendorId || null, assigneeIds: [], estimateCents: null, notifyVendor: Boolean(vendorId), parentTaskId: null, inspectionKind: null,
      });
      if (!r.ok) { setBusy(false); setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      if (photos.length) {
        const fd = new FormData();
        for (const f of photos) fd.append("files", f);
        fd.append("entityType", "Task");
        fd.append("entityId", r.data.id);
        const up = await uploadFiles(fd);
        if (!up.ok) toast.error(`Repair saved, but the photos didn't upload: ${up.error}`);
      }
      setBusy(false);
      const href = `/app/tasks/${r.data.id}`;
      toast.success(`Repair #${r.data.number} reported`, { action: { label: "Open", onClick: () => router.push(href) } });
      if (modal) {
        modal.close();
        router.refresh();
      } else router.push(href);
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="1. Which property?" description="Optional. You can attach the property later." error={errors.propertyId}>{(a) => (
          <NativeSelect {...a} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId(""); }}>
            <option value="">Choose…</option>
            {options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        )}</Field>
        <Field label="Which unit? (if any)">{(a) => (
          <NativeSelect {...a} value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!property || property.units.length === 0}>
            <option value="">The whole property / outside</option>
            {property?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        )}</Field>
      </div>
      <Field label="2. What's wrong?" required error={errors.title} description="A few words, like “Kitchen sink is leaking”.">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="More details (optional)">{(a) => <Textarea {...a} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Where exactly, when it started, anything you've tried…" />}</Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">3. How urgent is it?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {URGENCY.map((u) => (
            <label key={u.value} className={cn("cursor-pointer rounded-card border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring", urgency === u.value ? (u.value === "URGENT" ? "border-danger bg-danger-soft" : "border-primary bg-primary-soft/50") : "border-border")}>
              <input type="radio" name="urgency" value={u.value} checked={urgency === u.value} onChange={() => setUrgency(u.value)} className="sr-only" />
              <span className="block font-semibold">{urgency === u.value ? "✓ " : ""}{u.label}</span>
              <span className="block text-xs text-muted-foreground">{u.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="mb-2 text-sm font-medium">4. Photos (optional)</p>
        <div className="flex flex-wrap items-center gap-2">
          {previews.map((u, i) => (
            <span key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Photo ${i + 1}`} className="size-20 rounded-lg border border-border object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 rounded-full bg-surface p-1 shadow ring-1 ring-border"><X className="size-3.5" aria-hidden /></button>
            </span>
          ))}
          <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-strong px-4 text-sm font-medium text-muted-foreground hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring">
            <Camera className="size-6" aria-hidden /> Add photos
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; setPhotos([...photos, ...f].slice(0, 10)); }} />
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">On a phone this opens the camera. Up to 10 photos.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="5. Type of repair (optional)">{(a) => (
          <NativeSelect {...a} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Not sure</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </NativeSelect>
        )}</Field>
        <Field label="Who should fix it? (optional)" description={vendorId ? "They'll get the job by email." : "Leave empty to decide later."}>{(a) => (
          <NativeSelect {...a} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Decide later</option>
            {[...options.vendors].sort((x, y) => Number(y.trades.includes(category)) - Number(x.trades.includes(category))).map((v) => <option key={v.id} value={v.id}>{v.name}{category && v.trades.includes(category) ? " (does this kind of work)" : ""}</option>)}
          </NativeSelect>
        )}</Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {modal ? <Button type="button" variant="ghost" onClick={modal.close}>Cancel</Button> : null}
        <Button type="submit" size="lg" loading={busy}>Report repair</Button>
      </div>
    </form>
  );
}
