"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { useCreateModal } from "@/components/create/create-modal";
import { CATEGORIES, PRIORITIES, PRIORITY_LABEL, TASK_TYPE_LABEL, type TaskInput } from "@/lib/maintenance";
import { createTaskAction } from "@/server/actions/maintenance";
import type { TaskFormOptions } from "@/server/maintenance/queries";

type Kind = "TASK" | "WORK_ORDER" | "INSPECTION" | "OWNER_REQUEST" | "TENANT_REQUEST";

/** New task / work order / inspection. Opens as a modal route or a full page. */
export function TaskForm({ options, defaultType = "TASK", preset = {} }: { options: TaskFormOptions; defaultType?: Kind; preset?: { propertyId?: string; unitId?: string; parentTaskId?: string; leaseId?: string; dueDate?: string; type?: Kind } }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [type, setType] = React.useState<Kind>(defaultType);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [priority, setPriority] = React.useState<(typeof PRIORITIES)[number]>("NORMAL");
  const [dueDate, setDueDate] = React.useState(preset.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(preset.dueDate) ? preset.dueDate : "");
  const presetProp = preset.propertyId ?? options.properties.find((p) => p.units.some((u) => u.id === preset.unitId))?.id ?? "";
  const [propertyId, setPropertyId] = React.useState(presetProp);
  const [unitId, setUnitId] = React.useState(preset.unitId ?? "");
  const [vendorId, setVendorId] = React.useState("");
  const [notifyVendor, setNotifyVendor] = React.useState(true);
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [estimate, setEstimate] = React.useState<number | null>(null);
  const [inspectionKind, setInspectionKind] = React.useState<"MOVE_IN" | "MOVE_OUT" | "PERIODIC">("MOVE_OUT");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const property = options.properties.find((p) => p.id === propertyId);
  const vendor = options.vendors.find((v) => v.id === vendorId);
  const suggested = category ? options.vendors.filter((v) => v.trades.includes(category)) : [];

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const input: TaskInput = {
          type, title, description, category: category || null, priority, dueDate, propertyId: propertyId || null, unitId: unitId || null,
          leaseId: preset.leaseId ?? null, vendorId: vendorId || null, assigneeIds, estimateCents: estimate, notifyVendor: Boolean(vendorId) && notifyVendor,
          parentTaskId: preset.parentTaskId ?? null, inspectionKind: type === "INSPECTION" ? inspectionKind : null,
        };
        const r = await createTaskAction(input);
        setBusy(false);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          return void toast.error(r.error);
        }
        toast.success(`${TASK_TYPE_LABEL[type]} #${r.data.number} created`);
        if (modal) {
          modal.close();
          router.refresh();
        } else router.push(`/app/tasks/${r.data.id}`);
      }}
    >
      <Field label="Type" className="sm:col-span-2">
        {(a) => (
          <NativeSelect {...a} value={type} onChange={(e) => setType(e.target.value as Kind)}>
            {(["TASK", "WORK_ORDER", "INSPECTION", "OWNER_REQUEST", "TENANT_REQUEST"] as const).map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Title" error={errors.title} required className="sm:col-span-2">
        {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "INSPECTION" ? "e.g. Move-out inspection" : "e.g. Kitchen faucet dripping"} />}
      </Field>
      <Field label="Details" className="sm:col-span-2">
        {(a) => <Textarea {...a} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label="Property" error={errors.propertyId}>
        {(a) => (
          <NativeSelect {...a} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId(""); }}>
            <option value="">No property</option>
            {options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Unit" error={errors.unitId}>
        {(a) => (
          <NativeSelect {...a} value={unitId} disabled={!property} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{property ? "Whole property" : "Choose a property first"}</option>
            {property?.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        )}
      </Field>
      {type === "INSPECTION" ? (
        <Field label="Inspection type">
          {(a) => (
            <NativeSelect {...a} value={inspectionKind} onChange={(e) => setInspectionKind(e.target.value as typeof inspectionKind)}>
              <option value="MOVE_IN">Move-in</option>
              <option value="MOVE_OUT">Move-out</option>
              <option value="PERIODIC">Periodic</option>
            </NativeSelect>
          )}
        </Field>
      ) : (
        <Field label="Category" description="Used by auto-assign rules and to suggest vendors.">
          {(a) => (
            <NativeSelect {...a} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          )}
        </Field>
      )}
      <Field label="Priority">
        {(a) => (
          <NativeSelect {...a} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Due date">{(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
      {type !== "INSPECTION" ? (
        <Field label="Vendor" error={errors.vendorId} description={suggested.length ? `Suggested for this category: ${suggested.map((v) => v.name).join(", ")}. Optional.` : "Optional. You can assign a vendor later."}>
          {(a) => (
            <NativeSelect {...a} value={vendorId} onChange={(e) => { setVendorId(e.target.value); if (e.target.value && type === "TASK") setType("WORK_ORDER"); }}>
              <option value="">No vendor</option>
              {options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      {vendorId ? (
        <>
          <Field label="Cost estimate">{(a) => <MoneyInput {...a} valueCents={estimate} onChangeCents={setEstimate} />}</Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={notifyVendor} disabled={!vendor?.hasEmail} onChange={(e) => setNotifyVendor(e.target.checked)} />
            Email the work order to {vendor?.name}{vendor?.hasEmail ? "" : " (no email on file)"}
          </label>
        </>
      ) : null}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-[13px] font-medium">Assignees</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {options.members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={assigneeIds.includes(m.id)} onChange={(e) => setAssigneeIds(e.target.checked ? [...assigneeIds, m.id] : assigneeIds.filter((x) => x !== m.id))} />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>Create {TASK_TYPE_LABEL[type].toLowerCase()}</Button>
      </div>
    </form>
  );
}
