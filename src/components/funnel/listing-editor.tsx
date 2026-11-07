"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeListingAction, saveListingAction, setListingStatusAction } from "@/server/actions/funnel";

export type UnitOption = { id: string; label: string; marketRentCents: number };
export type ListingDraft = { id?: string; unitId: string; title: string; description: string; rentCents: number | null; depositCents: number | null; availableOn: string; leaseTermMonths: number; petPolicy: string; syndicate: boolean };

export function ListingEditor({ units, initial, trigger }: { units: UnitOption[]; initial?: ListingDraft; trigger: React.ReactNode }) {
  const router = useRouter();
  const blank: ListingDraft = { unitId: "", title: "", description: "", rentCents: null, depositCents: null, availableOn: "", leaseTermMonths: 12, petPolicy: "Cats and small dogs welcome", syndicate: true };
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<ListingDraft>(initial ?? blank);
  const [busy, setBusy] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (p: Partial<ListingDraft>) => setF({ ...f, ...p });
  const save = async (publish: boolean) => {
    setBusy(publish ? "publish" : "save");
    const r = await saveListingAction(f.id ?? null, { ...f, rentCents: f.rentCents ?? 0, depositCents: f.depositCents ?? 0, availableOn: f.availableOn || null }, publish);
    setBusy("");
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
    toast.success(r.message);
    setOpen(false);
    if (!initial) setF(blank);
    router.refresh();
  };
  return (
    <>
      <span onClickCapture={() => setOpen(true)}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{initial ? "Edit listing" : "New listing"}</DialogTitle><DialogDescription>Published listings appear on your public page and in the syndication feed. They come down automatically when the unit is leased.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Unit" required error={errors.unitId} className="sm:col-span-2">{(a) => (
              <NativeSelect {...a} value={f.unitId} disabled={Boolean(initial)} onChange={(e) => { const u = units.find((x) => x.id === e.target.value); set({ unitId: e.target.value, rentCents: f.rentCents ?? u?.marketRentCents ?? null, depositCents: f.depositCents ?? u?.marketRentCents ?? null, title: f.title || (u ? `${u.label} — available now` : "") }); }}>
                <option value="">Choose a vacant unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </NativeSelect>
            )}</Field>
            <Field label="Headline" required error={errors.title} className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
            <Field label="Monthly rent" required error={errors.rentCents}>{(a) => <MoneyInput {...a} valueCents={f.rentCents} onChangeCents={(c) => set({ rentCents: c })} />}</Field>
            <Field label="Deposit">{(a) => <MoneyInput {...a} valueCents={f.depositCents} onChangeCents={(c) => set({ depositCents: c })} />}</Field>
            <Field label="Available on">{(a) => <Input {...a} type="date" value={f.availableOn} onChange={(e) => set({ availableOn: e.target.value })} />}</Field>
            <Field label="Lease term">{(a) => <NativeSelect {...a} value={f.leaseTermMonths} onChange={(e) => set({ leaseTermMonths: Number(e.target.value) })}>{[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</NativeSelect>}</Field>
            <Field label="Pet policy" className="sm:col-span-2">{(a) => <Input {...a} value={f.petPolicy} onChange={(e) => set({ petPolicy: e.target.value })} />}</Field>
            <div className="sm:col-span-2">
              <Field label="Description" error={errors.description}>{(a) => <Textarea {...a} rows={7} value={f.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
              <Button type="button" size="sm" variant="secondary" className="mt-2" disabled={!f.unitId} loading={busy === "ai"} onClick={async () => {
                setBusy("ai");
                const r = await describeListingAction(f.unitId, f.rentCents ?? 0, f.petPolicy);
                setBusy("");
                if (!r.ok) return void toast.error(r.error);
                set({ description: r.data });
                toast.success("Description drafted from the unit's details — review before publishing");
              }}><Sparkles aria-hidden /> Write with AI</Button>
            </div>
            <label className="flex items-center gap-3 text-sm sm:col-span-2"><Switch checked={f.syndicate} onCheckedChange={(v) => set({ syndicate: v })} aria-label="Include in the syndication feed" /> Include in the syndication feed (Zillow, Apartments.com and other sites that read your feed)</label>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="secondary" loading={busy === "save"} onClick={() => save(false)}>Save</Button>
            <Button loading={busy === "publish"} onClick={() => save(true)}>Save &amp; publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ListingStatusButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const next = status === "PUBLISHED" ? "UNLISTED" : "PUBLISHED";
  return <Button size="sm" variant={next === "PUBLISHED" ? "primary" : "ghost"} onClick={async () => { const r = await setListingStatusAction(id, next); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }}>{next === "PUBLISHED" ? "Publish" : "Unlist"}</Button>;
}
