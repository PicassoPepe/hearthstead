"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilLine, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { refreshLandRecordAction, saveManualLandRecordAction } from "@/server/actions/rentals";
import { uploadFiles } from "@/server/actions/records";

export function RefreshLandRecordButton({ propertyId, hasRecord }: { propertyId: string; hasRecord: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant={hasRecord ? "secondary" : "primary"} loading={busy} onClick={async () => {
      setBusy(true);
      const r = await refreshLandRecordAction(propertyId);
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      if (r.data.status === "LOOKED_UP") toast.success("County record updated");
      else toast.warning(r.data.message ?? "No parcel found for this address");
      router.refresh();
    }}><RefreshCw aria-hidden /> {hasRecord ? "Refresh from county" : "Look up county record"}</Button>
  );
}

export function LandDocsUpload({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [category, setCategory] = React.useState("Deed");
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Document type" className="w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="Deed">Deed</option>
        <option value="TitlePolicy">Title policy</option>
        <option value="Survey">Survey</option>
        <option value="Plat">Plat</option>
      </NativeSelect>
      <label htmlFor={id} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Upload className="size-4" aria-hidden /> {busy ? "Uploading…" : "Attach document"}
        <input id={id} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.append("files", f);
          fd.append("entityType", "Property");
          fd.append("entityId", propertyId);
          fd.append("category", category);
          setBusy(true);
          const r = await uploadFiles(fd);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Document attached");
          router.refresh();
        }} />
      </label>
    </div>
  );
}

type Manual = { parcelId: string | null; ownerName: string | null; acres: number | null; landUse: string | null; assessedValueCents: number | null; taxYear: number | null; lastSaleDate: string | null; lastSalePriceCents: number | null; deedBook: string | null; deedPage: string | null; legalDescription: string | null };

/** Type in the record from the PVA site, the deed, Zillow… (for counties without public data). */
export function EnterLandRecordButton({ propertyId, initial }: { propertyId: string; initial: Manual | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const blank = { parcelId: "", ownerName: "", acres: "", landUse: "", assessed: null as number | null, taxYear: "", lastSaleDate: "", salePrice: null as number | null, deedBook: "", deedPage: "", legalDescription: "" };
  const [v, setV] = React.useState(blank);
  const start = () => {
    setV(initial ? { parcelId: initial.parcelId ?? "", ownerName: initial.ownerName ?? "", acres: initial.acres?.toString() ?? "", landUse: initial.landUse ?? "", assessed: initial.assessedValueCents, taxYear: initial.taxYear?.toString() ?? "", lastSaleDate: initial.lastSaleDate ?? "", salePrice: initial.lastSalePriceCents, deedBook: initial.deedBook ?? "", deedPage: initial.deedPage ?? "", legalDescription: initial.legalDescription ?? "" } : blank);
    setErrors({});
    setOpen(true);
  };
  const text = (k: keyof typeof v, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} error={errors[k]}>{(a) => <Input {...a} {...extra} value={String(v[k] ?? "")} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>
  );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={start}><PencilLine aria-hidden /> Enter details</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" aria-describedby="lr-enter-desc">
          <DialogHeader>
            <DialogTitle>Enter land record details</DialogTitle>
            <DialogDescription id="lr-enter-desc">Copy what the county PVA site, the deed or a listing shows. DeedWood keeps these until you change them; automatic refreshes won&apos;t overwrite them.</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await saveManualLandRecordAction(propertyId, {
              parcelId: v.parcelId, ownerName: v.ownerName, acres: v.acres.trim() ? Number(v.acres) : null, landUse: v.landUse, assessedValueCents: v.assessed, taxYear: v.taxYear.trim() ? Number(v.taxYear) : null,
              lastSaleDate: v.lastSaleDate, lastSalePriceCents: v.salePrice, deedBook: v.deedBook, deedPage: v.deedPage, legalDescription: v.legalDescription,
            });
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            toast.success("Land record saved");
            setOpen(false);
            router.refresh();
          }}>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              {text("parcelId", "Parcel ID / map number")}
              {text("ownerName", "Owner of record")}
              {text("acres", "Acres", { inputMode: "decimal" })}
              {text("landUse", "Land use / class")}
              <Field label="Assessed value">{(a) => <MoneyInput {...a} valueCents={v.assessed} onChangeCents={(c) => setV({ ...v, assessed: c })} />}</Field>
              {text("taxYear", "Tax year", { inputMode: "numeric" })}
              {text("lastSaleDate", "Last sale date", { type: "date" })}
              <Field label="Last sale price">{(a) => <MoneyInput {...a} valueCents={v.salePrice} onChangeCents={(c) => setV({ ...v, salePrice: c })} />}</Field>
              {text("deedBook", "Deed book")}
              {text("deedPage", "Deed page")}
              <Field label="Legal description" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={v.legalDescription} onChange={(e) => setV({ ...v, legalDescription: e.target.value })} />}</Field>
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
