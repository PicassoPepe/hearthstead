"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { submitVendorInvoiceAction } from "@/server/actions/books";

export function VendorInvoiceForm({ today, workOrders }: { today: string; workOrders: { id: string; label: string }[] }) {
  const router = useRouter();
  const [v, setV] = React.useState({ invoiceNumber: "", invoiceDate: today, amountCents: null as number | null, description: "", taskId: workOrders[0]?.id ?? "" });
  const [file, setFile] = React.useState<File | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <form noValidate className="grid gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.set("invoiceNumber", v.invoiceNumber);
      fd.set("invoiceDate", v.invoiceDate);
      fd.set("amountCents", String(v.amountCents ?? 0));
      fd.set("description", v.description);
      fd.set("taskId", v.taskId);
      if (file) fd.set("file", file);
      setBusy(true);
      const r = await submitVendorInvoiceAction(fd);
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Invoice submitted");
      setErrors({});
      setV({ invoiceNumber: "", invoiceDate: today, amountCents: null, description: "", taskId: "" });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    }}>
      <Field label="Work order" error={errors.taskId}>{(a) => <NativeSelect {...a} value={v.taskId} onChange={(e) => setV({ ...v, taskId: e.target.value })}><option value="">Not for a specific work order</option>{workOrders.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</NativeSelect>}</Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Invoice #" required error={errors.invoiceNumber}>{(a) => <Input {...a} value={v.invoiceNumber} onChange={(e) => setV({ ...v, invoiceNumber: e.target.value })} />}</Field>
        <Field label="Date" required error={errors.invoiceDate}>{(a) => <Input {...a} type="date" value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} />}</Field>
      </div>
      <Field label="Amount" required error={errors.amountCents}>{(a) => <MoneyInput {...a} valueCents={v.amountCents} onChangeCents={(c) => setV({ ...v, amountCents: c })} />}</Field>
      <Field label="Work performed" required error={errors.description}>{(a) => <Textarea {...a} rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
      <Field label="Invoice file (PDF, PNG or JPG)" error={errors.file}>{(a) => <input {...a} ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
      <Button type="submit" loading={busy}>Submit invoice</Button>
    </form>
  );
}
