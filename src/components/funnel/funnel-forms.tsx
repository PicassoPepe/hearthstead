"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateModal } from "@/components/create/create-modal";
import { createProspectAction, scheduleShowingAction, sendRenewalAction, setProspectStatusAction, setRenewalStatusAction, setShowingStatusAction } from "@/server/actions/funnel";
import { PROSPECT_STATUSES, PROSPECT_STATUS_LABEL, SOURCES } from "@/lib/funnel";
import { formatMoney } from "@/lib/money";

export function ProspectForm({ listings }: { listings: { id: string; label: string }[] }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [f, setF] = React.useState({ firstName: "", lastName: "", email: "", phone: "", source: "WEBSITE", listingId: "", notes: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await createProspectAction({ ...f, listingId: f.listingId || null });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Prospect added");
      if (modal) modal.close(); else router.push("/app/people/prospects");
      router.refresh();
    }}>
      <Field label="First name" required error={errors.firstName}>{(a) => <Input {...a} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />}</Field>
      <Field label="Last name" required error={errors.lastName}>{(a) => <Input {...a} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />}</Field>
      <Field label="Email" error={errors.email}>{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      <Field label="Source">{(a) => <NativeSelect {...a} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</NativeSelect>}</Field>
      <Field label="Interested in">{(a) => <NativeSelect {...a} value={f.listingId} onChange={(e) => setF({ ...f, listingId: e.target.value })}><option value="">—</option>{listings.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</NativeSelect>}</Field>
      <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      <div className="flex justify-end gap-2 sm:col-span-2">{modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}<Button type="submit" loading={busy}>Add prospect</Button></div>
    </form>
  );
}

export function ProspectStatusSelect({ id, status, name }: { id: string; status: string; name: string }) {
  const router = useRouter();
  return (
    <NativeSelect aria-label={`Status for ${name}`} className="w-36" value={status} onChange={async (e) => { const r = await setProspectStatusAction(id, e.target.value); if (!r.ok) return void toast.error(r.error); router.refresh(); }}>
      {PROSPECT_STATUSES.map((s) => <option key={s} value={s}>{PROSPECT_STATUS_LABEL[s]}</option>)}
    </NativeSelect>
  );
}

export function ScheduleShowing({ listings, prospects }: { listings: { id: string; label: string }[]; prospects: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ listingId: listings[0]?.id ?? "", prospectId: "", startsAt: "", durationMin: 30, notes: "" });
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!listings.length}>Schedule showing</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule a showing</DialogTitle><DialogDescription>Double-booking the same unit is blocked.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3">
            <Field label="Listing" required>{(a) => <NativeSelect {...a} value={f.listingId} onChange={(e) => setF({ ...f, listingId: e.target.value })}>{listings.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</NativeSelect>}</Field>
            <Field label="Prospect" required>{(a) => <NativeSelect {...a} value={f.prospectId} onChange={(e) => setF({ ...f, prospectId: e.target.value })}><option value="">Choose…</option>{prospects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</NativeSelect>}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="When" required>{(a) => <Input {...a} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
              <Field label="Length">{(a) => <NativeSelect {...a} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}>{[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</NativeSelect>}</Field>
            </div>
            <Field label="Notes">{(a) => <Input {...a} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Lockbox code 4471" />}</Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              if (!f.prospectId || !f.startsAt) return void toast.error("Choose a prospect and time");
              setBusy(true);
              const r = await scheduleShowingAction({ ...f, startsAt: new Date(f.startsAt).toISOString() });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
              router.refresh();
            }}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ShowingStatusButtons({ id }: { id: string }) {
  const router = useRouter();
  const go = async (s: "COMPLETED" | "NO_SHOW" | "CANCELED") => { const r = await setShowingStatusAction(id, s); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); };
  return <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => go("COMPLETED")}>Toured</Button><Button size="sm" variant="ghost" onClick={() => go("NO_SHOW")}>No-show</Button><Button size="sm" variant="ghost" onClick={() => go("CANCELED")}>Cancel</Button></span>;
}

export function RenewalOfferButton({ leaseId, label, rentCents, suggestedCents }: { leaseId: string; label: string; rentCents: number; suggestedCents: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rent, setRent] = React.useState<number | null>(suggestedCents);
  const [term, setTerm] = React.useState(12);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const pct = rent ? ((rent - rentCents) / Math.max(1, rentCents)) * 100 : 0;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Offer renewal for ${label}`}>Offer renewal</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renewal offer — {label}</DialogTitle><DialogDescription>The tenant gets the renewal addendum to e-sign. Signing creates the new lease automatically.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="New monthly rent" required description={`Current ${formatMoney(rentCents)} · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}>{(a) => <MoneyInput {...a} valueCents={rent} onChangeCents={setRent} />}</Field>
              <Field label="Term">{(a) => <NativeSelect {...a} value={term} onChange={(e) => setTerm(Number(e.target.value))}>{[6, 12, 18, 24].map((m) => <option key={m} value={m}>{m} months</option>)}</NativeSelect>}</Field>
            </div>
            <Field label="Note to tenant (optional)">{(a) => <Textarea {...a} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              setBusy(true);
              const r = await sendRenewalAction({ leaseId, newRentCents: rent ?? 0, termMonths: term, message: message || undefined });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
              router.refresh();
            }}>Send offer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RenewalStatusButtons({ offerId }: { offerId: string }) {
  const router = useRouter();
  const go = async (s: "ACCEPTED" | "DECLINED" | "WITHDRAWN") => { const r = await setRenewalStatusAction(offerId, s); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); };
  return <span className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => go("ACCEPTED")}>Mark accepted</Button><Button size="sm" variant="ghost" onClick={() => go("DECLINED")}>Declined</Button><Button size="sm" variant="ghost" onClick={() => go("WITHDRAWN")}>Withdraw</Button></span>;
}
