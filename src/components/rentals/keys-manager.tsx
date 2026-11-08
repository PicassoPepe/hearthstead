"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Car, KeyRound, Mailbox, Package, Plus, Radio, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { assignKeyItemAction, returnKeyItemAction, saveKeyItemAction, setKeyStatusAction } from "@/server/actions/keys";

const KINDS = { KEY: "Key", FOB: "Fob / access card", REMOTE: "Garage remote", PARKING: "Parking space", STORAGE: "Storage unit", MAILBOX: "Mailbox", OTHER: "Other" } as const;
type Kind = keyof typeof KINDS;
const ICON: Record<string, typeof KeyRound> = { KEY: KeyRound, FOB: Wifi, REMOTE: Radio, PARKING: Car, STORAGE: Package, MAILBOX: Mailbox, OTHER: KeyRound };
const TONE: Record<string, "success" | "info" | "danger" | "neutral"> = { AVAILABLE: "success", ASSIGNED: "info", LOST: "danger", RETIRED: "neutral" };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

type Item = { id: string; kind: string; label: string; propertyId: string; property: string; unitId: string | null; unit: string | null; status: string; leaseId: string | null; holder: string | null; assignedAt: string | null; feeCents: number; billed: boolean; notes: string | null };
type Prop = { id: string; name: string; units: { id: string; name: string }[] };
type LeaseOpt = { id: string; propertyId: string; label: string };
type Mode = { m: "edit"; item: Item | null } | { m: "assign"; item: Item } | { m: "return"; item: Item } | null;

export function KeysManager({ items, properties, leases, canEdit, today, initialProperty }: { items: Item[]; properties: Prop[]; leases: LeaseOpt[]; canEdit: boolean; today: string; initialProperty: string }) {
  const router = useRouter();
  const [property, setProperty] = React.useState(initialProperty);
  const [kind, setKind] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [mode, setMode] = React.useState<Mode>(null);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [f, setF] = React.useState({ kind: "KEY" as Kind, label: "", propertyId: "", unitId: "", feeCents: null as number | null, notes: "", leaseId: "", date: today, billFee: true, lost: false });
  const shown = items.filter((i) => (!property || i.propertyId === property) && (!kind || i.kind === kind) && (!status || i.status === status));
  const counts = { assigned: shown.filter((i) => i.status === "ASSIGNED").length, available: shown.filter((i) => i.status === "AVAILABLE").length, lost: shown.filter((i) => i.status === "LOST").length };

  const open = (m: Mode) => {
    setErrors({});
    if (m?.m === "edit") setF({ ...f, kind: (m.item?.kind as Kind) ?? "KEY", label: m.item?.label ?? "", propertyId: m.item?.propertyId ?? property ?? properties[0]?.id ?? "", unitId: m.item?.unitId ?? "", feeCents: m.item?.feeCents ?? null, notes: m.item?.notes ?? "" });
    if (m?.m === "assign") setF({ ...f, leaseId: leases.find((l) => l.propertyId === m.item.propertyId)?.id ?? "", date: today, billFee: m.item.feeCents > 0 });
    if (m?.m === "return") setF({ ...f, date: today, lost: false });
    setMode(m);
  };
  const run = async (p: Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
    toast.success(r.message ?? "Saved");
    setMode(null);
    router.refresh();
  };
  const spaceKind = f.kind === "PARKING" || f.kind === "STORAGE";
  const units = properties.find((p) => p.id === f.propertyId)?.units ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Property">{(a) => <NativeSelect {...a} value={property} onChange={(e) => setProperty(e.target.value)}><option value="">All properties</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
        <Field label="Type">{(a) => <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>}</Field>
        <Field label="Status">{(a) => <NativeSelect {...a} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["AVAILABLE", "ASSIGNED", "LOST", "RETIRED"].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</NativeSelect>}</Field>
        <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">{counts.assigned} assigned · {counts.available} available{counts.lost ? ` · ${counts.lost} lost` : ""}</p>
        {canEdit ? <Button className="ml-auto" onClick={() => open({ m: "edit", item: null })}><Plus aria-hidden /> Add key or space</Button> : null}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <KeyRound className="mx-auto mb-2 size-8" aria-hidden />
          Nothing tracked yet. Add keys, fobs, parking spaces and storage units to know who has what at move-out.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="key-items">
          {shown.map((i) => {
            const Icon = ICON[i.kind] ?? KeyRound;
            return (
              <li key={i.id} className="flex flex-col rounded-card border border-border bg-surface p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><Icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{i.label}</h3>
                    <p className="truncate text-xs text-muted-foreground">{KINDS[i.kind as Kind] ?? i.kind} · {i.property}{i.unit ? ` · ${i.unit}` : ""}</p>
                  </div>
                  <Badge tone={TONE[i.status] ?? "neutral"}>{i.status.charAt(0) + i.status.slice(1).toLowerCase()}</Badge>
                </div>
                <div className="mt-3 flex-1 text-sm">
                  {i.status === "ASSIGNED" ? <p>Held by <Link className="font-medium text-primary hover:underline" href={`/app/leasing/${i.leaseId}`}>{i.holder ?? "lease"}</Link> since {i.assignedAt}</p> : null}
                  {i.feeCents ? <p className="text-muted-foreground">{money(i.feeCents)}/mo{i.billed ? " · billing on the lease" : ""}</p> : null}
                  {i.notes ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.notes}</p> : null}
                </div>
                {canEdit ? (
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
                    {i.status === "ASSIGNED" ? <Button size="sm" variant="secondary" onClick={() => open({ m: "return", item: i })}>Return…</Button> : i.status === "AVAILABLE" ? <Button size="sm" variant="secondary" onClick={() => open({ m: "assign", item: i })}>Assign…</Button> : <Button size="sm" variant="ghost" onClick={() => run(setKeyStatusAction(i.id, "AVAILABLE"))}>Make available</Button>}
                    <Button size="sm" variant="ghost" onClick={() => open({ m: "edit", item: i })}>Edit</Button>
                    {i.status === "AVAILABLE" ? <Button size="sm" variant="ghost" onClick={() => run(setKeyStatusAction(i.id, "RETIRED"))}>Retire</Button> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent aria-describedby="key-desc">
          <DialogHeader>
            <DialogTitle>{mode?.m === "edit" ? (mode.item ? `Edit ${mode.item.label}` : "Add key or space") : mode?.m === "assign" ? `Assign ${mode.item.label}` : mode?.m === "return" ? `Return ${mode.item.label}` : ""}</DialogTitle>
            <DialogDescription id="key-desc">{mode?.m === "assign" ? "Hand it to a lease's tenants. Paid spaces can start billing on the lease (prorated)." : mode?.m === "return" ? "Returned items become available again; lost ones are flagged. Any monthly fee stops." : "Track it once, then assign and return it as tenants come and go."}</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={(e) => {
            e.preventDefault();
            if (mode?.m === "edit") void run(saveKeyItemAction(mode.item?.id ?? null, { kind: f.kind, label: f.label, propertyId: f.propertyId, unitId: f.unitId || null, monthlyFeeCents: spaceKind ? f.feeCents ?? 0 : 0, notes: f.notes }));
            if (mode?.m === "assign") void run(assignKeyItemAction(mode.item.id, { leaseId: f.leaseId, date: f.date, billFee: f.billFee }));
            if (mode?.m === "return") void run(returnKeyItemAction(mode.item.id, { date: f.date, lost: f.lost }));
          }}>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              {mode?.m === "edit" ? (
                <>
                  <Field label="Type">{(a) => <NativeSelect {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>}</Field>
                  <Field label="Label" required error={errors.label}>{(a) => <Input {...a} placeholder={f.kind === "PARKING" ? "P12" : f.kind === "STORAGE" ? "Locker B4" : "Front door #2"} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />}</Field>
                  <Field label="Property" required error={errors.propertyId}>{(a) => <NativeSelect {...a} value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value, unitId: "" })}><option value="">Choose…</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
                  <Field label="Unit (optional)" error={errors.unitId}>{(a) => <NativeSelect {...a} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}><option value="">Building / common</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>}</Field>
                  {spaceKind ? <Field label="Monthly fee" description="Leave empty if included in rent.">{(a) => <MoneyInput {...a} valueCents={f.feeCents} onChangeCents={(c) => setF({ ...f, feeCents: c })} />}</Field> : null}
                  <Field label="Notes" className="sm:col-span-2">{(a) => <Textarea {...a} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
                </>
              ) : mode?.m === "assign" ? (
                <>
                  <Field label="Lease" required error={errors.leaseId} className="sm:col-span-2">{(a) => <NativeSelect {...a} value={f.leaseId} onChange={(e) => setF({ ...f, leaseId: e.target.value })}><option value="">Choose…</option>{leases.filter((l) => l.propertyId === mode.item.propertyId).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</NativeSelect>}</Field>
                  <Field label="Date handed over">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
                  {mode.item.feeCents ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={f.billFee} onCheckedChange={(v) => setF({ ...f, billFee: v })} aria-label={`Bill ${money(mode.item.feeCents)} per month on the lease`} /> Bill {money(mode.item.feeCents)}/mo on the lease</label> : null}
                </>
              ) : mode?.m === "return" ? (
                <>
                  <Field label="Date returned">{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={f.lost} onCheckedChange={(v) => setF({ ...f, lost: v })} aria-label="Not returned — mark as lost" /> Not returned (lost)</label>
                </>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>{mode?.m === "assign" ? "Assign" : mode?.m === "return" ? (f.lost ? "Mark lost" : "Mark returned") : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
