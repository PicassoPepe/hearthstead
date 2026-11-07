"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import type { PropertyCash } from "@/server/accounting/owners";
import { contributionAction, distributeAction, distributeAllAction, runManagementFeesAction, saveFeeRulesAction } from "@/server/actions/books";

export function DistributionsTable({ rows, today, canEdit }: { rows: PropertyCash[]; today: string; canEdit: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [one, setOne] = React.useState<PropertyCash | null>(null);
  const [contrib, setContrib] = React.useState<PropertyCash | null>(null);
  const eligible = rows.filter((r) => r.availableCents > 0 && r.owners.length);
  const pickedTotal = rows.filter((r) => picked.includes(r.propertyId)).reduce((s, r) => s + r.availableCents, 0);
  return (
    <>
      {canEdit ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button loading={busy} disabled={!picked.length} onClick={async () => {
            setBusy(true);
            const r = await distributeAllAction(picked, today);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Distributed ${formatMoney(r.data.totalCents)} to ${r.data.count} owner${r.data.count === 1 ? "" : "s"}`);
            setPicked([]);
            router.refresh();
          }}>Distribute {picked.length ? formatMoney(pickedTotal) : "selected"}</Button>
          <span className="text-sm text-muted-foreground">Pays each owner their ownership share of what's available, dated today.</span>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Cash available to distribute by property</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              {canEdit ? <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" className="size-4" aria-label="Select all properties with cash available" checked={!!eligible.length && picked.length === eligible.length} onChange={(e) => setPicked(e.target.checked ? eligible.map((r) => r.propertyId) : [])} /></th> : null}
              <th scope="col" className="px-3 py-2 font-medium">Property</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cash</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Prepaid rent</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Open bills</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Reserve</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Available</th>
              <th scope="col" className="px-3 py-2 font-medium">Owners</th>
              {canEdit ? <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.propertyId} className="border-t border-border align-top">
                {canEdit ? <td className="px-3 py-2"><input type="checkbox" className="size-4" aria-label={`Select ${r.property}`} disabled={!eligible.includes(r)} checked={picked.includes(r.propertyId)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.propertyId] : picked.filter((x) => x !== r.propertyId))} /></td> : null}
                <td className="px-3 py-2 font-medium">{r.property}</td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(r.bankCents + r.undepositedCents)}</td>
                <td className="px-3 py-2 text-right tabular">{r.prepaidCents ? `−${formatMoney(r.prepaidCents)}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular">{r.payablesCents > 0 ? `−${formatMoney(r.payablesCents)}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular">{r.reserveCents ? `−${formatMoney(r.reserveCents)}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular font-semibold">{formatMoney(r.availableCents)}</td>
                <td className="px-3 py-2 text-xs">{r.owners.length ? r.owners.map((o) => <div key={o.ownerId}>{o.name} · {o.percentBps / 100}% → {formatMoney(o.shareCents)}</div>) : <span className="text-muted-foreground">No owners on file</span>}</td>
                {canEdit ? (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" disabled={!eligible.includes(r)} onClick={() => setOne(r)} aria-label={`Custom distribution for ${r.property}`}>Custom…</Button>
                    <Button size="sm" variant="ghost" disabled={!r.owners.length} onClick={() => setContrib(r)} aria-label={`Record contribution for ${r.property}`}>Contribution</Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CustomDistribution row={one} onClose={() => setOne(null)} today={today} />
      <ContributionDialog row={contrib} onClose={() => setContrib(null)} today={today} />
    </>
  );
}

function CustomDistribution({ row, onClose, today }: { row: PropertyCash | null; onClose: () => void; today: string }) {
  const router = useRouter();
  const [amounts, setAmounts] = React.useState<Record<string, number | null>>({});
  const [date, setDate] = React.useState(today);
  const [method, setMethod] = React.useState("ACH");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (row) setAmounts(Object.fromEntries(row.owners.map((o) => [o.ownerId, o.shareCents]))); }, [row]);
  const total = Object.values(amounts).reduce<number>((s, v) => s + (v ?? 0), 0);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Distribute — {row?.property}</DialogTitle><DialogDescription>{row ? `${formatMoney(row.availableCents)} available.` : ""}</DialogDescription></DialogHeader>
        <DialogBody className="grid gap-3">
          {row?.owners.map((o) => <Field key={o.ownerId} label={`${o.name} (${o.percentBps / 100}%)`}>{(a) => <MoneyInput {...a} valueCents={amounts[o.ownerId] ?? null} onChangeCents={(c) => setAmounts({ ...amounts, [o.ownerId]: c })} />}</Field>)}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Method">{(a) => <NativeSelect {...a} value={method} onChange={(e) => setMethod(e.target.value)}><option value="ACH">ACH</option><option value="CHECK">Check</option><option value="WIRE">Wire</option></NativeSelect>}</Field>
          </div>
          <p className={`text-sm ${row && total > row.availableCents ? "text-danger" : "text-muted-foreground"}`} aria-live="polite">Total {formatMoney(total)}{row && total > row.availableCents ? " — more than available" : ""}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!total || (row ? total > row.availableCents : true)} onClick={async () => {
            setBusy(true);
            const r = await distributeAction({ propertyId: row!.propertyId, date, method, amounts: Object.entries(amounts).map(([ownerId, c]) => ({ ownerId, amountCents: c ?? 0 })) });
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Distributed ${formatMoney(r.data.totalCents)}`);
            onClose();
            router.refresh();
          }}>Distribute {formatMoney(total)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContributionDialog({ row, onClose, today }: { row: PropertyCash | null; onClose: () => void; today: string }) {
  const router = useRouter();
  const [ownerId, setOwnerId] = React.useState("");
  const [amount, setAmount] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setOwnerId(row?.owners[0]?.ownerId ?? ""); setAmount(null); }, [row]);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Owner contribution — {row?.property}</DialogTitle><DialogDescription>Money an owner puts in (e.g. to cover a big repair). Posts Dr bank, Cr Owner Contributions.</DialogDescription></DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Owner" required>{(a) => <NativeSelect {...a} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{row?.owners.map((o) => <option key={o.ownerId} value={o.ownerId}>{o.name}</option>)}</NativeSelect>}</Field>
          <Field label="Amount" required>{(a) => <MoneyInput {...a} valueCents={amount} onChangeCents={setAmount} />}</Field>
          <Field label="Date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!amount) return void toast.error("Enter an amount");
            setBusy(true);
            const r = await contributionAction({ propertyId: row!.propertyId, ownerId, amountCents: amount, date });
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Contribution of ${formatMoney(amount)} recorded`);
            onClose();
            router.refresh();
          }}>Record contribution</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- management fees

export function RunFeesButton({ defaultPeriod }: { defaultPeriod: string }) {
  const router = useRouter();
  const [period, setPeriod] = React.useState(defaultPeriod);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Month">{(a) => <Input {...a} type="month" className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        const r = await runManagementFeesAction(period);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.data.created ? `Charged ${formatMoney(r.data.totalCents)} in fees to ${r.data.created} properties` : `Nothing new to charge for ${period}${r.data.skipped ? " — already run" : ""}`);
        router.refresh();
      }}>Run management fees</Button>
    </div>
  );
}

type Rule = { key: number; propertyId: string | null; type: "PERCENT" | "FLAT"; percent: string; flatCents: number | null; minimumCents: number | null; basis: "COLLECTED_RENT" | "COLLECTED_INCOME" };
let rk = 0;

export function FeeRulesEditor({ rules: initial, properties, canEdit }: { rules: { propertyId: string | null; type: string; percentBps: number; flatCents: number; minimumCents: number; basis: string }[]; properties: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const toRule = (r: (typeof initial)[number]): Rule => ({ key: rk++, propertyId: r.propertyId, type: r.type as Rule["type"], percent: String(r.percentBps / 100), flatCents: r.flatCents, minimumCents: r.minimumCents, basis: r.basis as Rule["basis"] });
  const [rules, setRules] = React.useState<Rule[]>(() => {
    const list = initial.map(toRule);
    if (!list.some((r) => r.propertyId === null)) list.unshift({ key: rk++, propertyId: null, type: "PERCENT", percent: "8", flatCents: 0, minimumCents: 0, basis: "COLLECTED_RENT" });
    return list.sort((a, b) => (a.propertyId === null ? -1 : b.propertyId === null ? 1 : 0));
  });
  const [busy, setBusy] = React.useState(false);
  const set = (key: number, patch: Partial<Rule>) => setRules(rules.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const used = new Set(rules.map((r) => r.propertyId));
  return (
    <div className="grid gap-3">
      {rules.map((r) => {
        const name = r.propertyId === null ? "Company default" : properties.find((p) => p.id === r.propertyId)?.name ?? "Property";
        return (
          <fieldset key={r.key} className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-5" disabled={!canEdit}>
            <legend className="sr-only">{name}</legend>
            <div className="sm:col-span-5 flex items-center justify-between">
              {r.propertyId === null ? <span className="font-semibold">Company default <span className="text-xs font-normal text-muted-foreground">applies to every property without an override</span></span> : (
                <NativeSelect aria-label="Override property" className="w-64" value={r.propertyId} onChange={(e) => set(r.key, { propertyId: e.target.value })}>
                  {properties.filter((p) => p.id === r.propertyId || !used.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              )}
              {r.propertyId !== null ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove override for ${name}`} onClick={() => setRules(rules.filter((x) => x.key !== r.key))}><Trash2 aria-hidden /></Button> : null}
            </div>
            <Field label="Fee type">{(a) => <NativeSelect {...a} value={r.type} onChange={(e) => set(r.key, { type: e.target.value as Rule["type"] })}><option value="PERCENT">Percent</option><option value="FLAT">Flat monthly</option></NativeSelect>}</Field>
            {r.type === "PERCENT" ? (
              <>
                <Field label="Percent">{(a) => <Input {...a} inputMode="decimal" value={r.percent} onChange={(e) => set(r.key, { percent: e.target.value })} />}</Field>
                <Field label="Of">{(a) => <NativeSelect {...a} value={r.basis} onChange={(e) => set(r.key, { basis: e.target.value as Rule["basis"] })}><option value="COLLECTED_RENT">Collected rent</option><option value="COLLECTED_INCOME">All collected income</option></NativeSelect>}</Field>
                <Field label="Minimum per month">{(a) => <MoneyInput {...a} valueCents={r.minimumCents} onChangeCents={(c) => set(r.key, { minimumCents: c })} />}</Field>
              </>
            ) : <Field label="Amount per month">{(a) => <MoneyInput {...a} valueCents={r.flatCents} onChangeCents={(c) => set(r.key, { flatCents: c })} />}</Field>}
          </fieldset>
        );
      })}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={properties.every((p) => used.has(p.id))} onClick={() => { const p = properties.find((x) => !used.has(x.id)); if (p) setRules([...rules, { key: rk++, propertyId: p.id, type: "PERCENT", percent: "8", flatCents: 0, minimumCents: 0, basis: "COLLECTED_RENT" }]); }}><Plus aria-hidden /> Add property override</Button>
          <Button className="ml-auto" loading={busy} onClick={async () => {
            const bad = rules.find((r) => r.type === "PERCENT" && !/^\d{1,2}(\.\d{1,2})?$/.test(r.percent.trim()));
            if (bad) return void toast.error("Enter percentages like 8 or 7.5");
            setBusy(true);
            const res = await saveFeeRulesAction(rules.map((r) => ({ propertyId: r.propertyId, type: r.type, percentBps: Math.round(Number(r.percent) * 100), flatCents: r.flatCents ?? 0, minimumCents: r.minimumCents ?? 0, basis: r.basis })));
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Management fee rules saved");
            router.refresh();
          }}>Save rules</Button>
        </div>
      ) : null}
    </div>
  );
}
