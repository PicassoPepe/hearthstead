"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { applyRentIncrease, previewRentIncrease } from "@/server/actions/leasing";
import type { IncreaseLine } from "@/server/leasing/recurring";
import { cn } from "@/lib/utils";

type Row = { id: string; propertyId: string; property: string; units: string; tenant: string; rentCents: number; marketCents: number; endDate: string | null };
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function RentIncreaseTool({ rows, defaultEffective }: { rows: Row[]; defaultEffective: string }) {
  const router = useRouter();
  const props = [...new Map(rows.map((r) => [r.propertyId, r.property])).entries()];
  const [property, setProperty] = React.useState("");
  const [belowMarket, setBelowMarket] = React.useState(false);
  const visible = rows.filter((r) => (!property || r.propertyId === property) && (!belowMarket || r.rentCents < r.marketCents));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<"PERCENT" | "AMOUNT">("PERCENT");
  const [value, setValue] = React.useState("3");
  const [effective, setEffective] = React.useState(defaultEffective);
  const [round, setRound] = React.useState("100");
  const [notify, setNotify] = React.useState(true);
  const [preview, setPreview] = React.useState<IncreaseLine[] | null>(null);
  const [busy, setBusy] = React.useState("");
  const input = () => ({ leaseIds: [...selected], mode, value: mode === "PERCENT" ? Number(value) : Math.round(Number(value) * 100), effectiveDate: effective, roundToCents: Number(round), notify });
  const allVisible = visible.length > 0 && visible.every((r) => selected.has(r.id));
  React.useEffect(() => setPreview(null), [selected, mode, value, effective, round]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card md:grid-cols-[repeat(5,minmax(0,1fr))]">
        <Field label="Change by">{(a) => <NativeSelect {...a} value={mode} onChange={(e) => setMode(e.target.value as "PERCENT" | "AMOUNT")}><option value="PERCENT">Percent</option><option value="AMOUNT">Dollar amount</option></NativeSelect>}</Field>
        <Field label={mode === "PERCENT" ? "Percent" : "Amount ($)"}>{(a) => <Input {...a} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
        <Field label="Effective date">{(a) => <Input {...a} type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />}</Field>
        <Field label="Round to">{(a) => <NativeSelect {...a} value={round} onChange={(e) => setRound(e.target.value)}><option value="1">The cent</option><option value="100">Whole dollar</option><option value="500">$5</option><option value="2500">$25</option></NativeSelect>}</Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={notify} onCheckedChange={setNotify} aria-label="Email a rent change notice to tenants" /> Email tenants a notice</label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Property">{(a) => <NativeSelect {...a} value={property} onChange={(e) => setProperty(e.target.value)}><option value="">All properties</option>{props.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</NativeSelect>}</Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={belowMarket} onCheckedChange={setBelowMarket} aria-label="Only leases below market rent" /> Only below market rent</label>
        <span className="ml-auto pb-2 text-sm text-muted-foreground" aria-live="polite">{selected.size} selected</span>
        <Button variant="secondary" disabled={!selected.size} loading={busy === "preview"} onClick={async () => {
          setBusy("preview");
          const r = await previewRentIncrease(input());
          setBusy("");
          if (!r.ok) return void toast.error(r.error);
          setPreview(r.data);
        }}>Preview</Button>
        <Button disabled={!preview || !preview.some((p) => !p.error)} loading={busy === "apply"} onClick={async () => {
          setBusy("apply");
          const r = await applyRentIncrease(input());
          setBusy("");
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Rent updated on ${r.data.updated} lease${r.data.updated === 1 ? "" : "s"}${r.data.notified ? ` · ${r.data.notified} notice${r.data.notified === 1 ? "" : "s"} emailed` : ""}`);
          setSelected(new Set());
          setPreview(null);
          router.refresh();
        }}>Apply {preview ? `to ${preview.filter((p) => !p.error).length}` : ""}</Button>
      </div>

      {preview ? (
        <section aria-labelledby="pv-h" className="rounded-card border border-primary/30 bg-primary-soft/30 p-4">
          <h2 id="pv-h" className="mb-2 font-semibold">Preview</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Monthly rent {money(preview.filter((p) => !p.error).reduce((n, p) => n + p.currentCents, 0))} → {money(preview.filter((p) => !p.error).reduce((n, p) => n + p.newCents, 0))}
          </p>
          <ul className="grid gap-1 text-sm" data-testid="increase-preview">
            {preview.map((p) => (
              <li key={p.leaseId} className={cn("flex flex-wrap justify-between gap-2", p.error && "text-danger")}>
                <span>{p.label}{p.tenant ? ` — ${p.tenant}` : ""}</span>
                <span className="tabular">{p.error ?? `${money(p.currentCents)} → ${money(p.newCents)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Active leases</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all shown leases" className="size-4 accent-[var(--primary)]" checked={allVisible} onChange={() => setSelected(allVisible ? new Set([...selected].filter((id) => !visible.some((v) => v.id === id))) : new Set([...selected, ...visible.map((v) => v.id)]))} /></th>
              {["Property", "Unit", "Tenant", "Rent", "Market", "Lease ends"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Select ${r.property} ${r.units}`} checked={selected.has(r.id)} onChange={() => { const n = new Set(selected); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setSelected(n); }} /></td>
                <td className="px-3 py-2 font-medium">{r.property}</td>
                <td className="px-3 py-2">{r.units}</td>
                <td className="px-3 py-2">{r.tenant}</td>
                <td className="px-3 py-2 tabular">{money(r.rentCents)}</td>
                <td className={cn("px-3 py-2 tabular", r.rentCents < r.marketCents && "text-warning-soft-foreground")}>{money(r.marketCents)}</td>
                <td className="px-3 py-2 tabular">{r.endDate ?? "Month-to-month"}</td>
              </tr>
            ))}
            {!visible.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No active leases match.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
