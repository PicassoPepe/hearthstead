"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Split, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { splitAmount, type SplitMethod } from "@/lib/accounting";
import type { BooksOptions } from "@/server/accounting/queries";

export type ExpenseLineDraft = { key: number; accountId: string; amountCents: number | null; propertyId: string; unitId: string; description: string };
let seq = 0;
export const blankLine = (accountId = ""): ExpenseLineDraft => ({ key: seq++, accountId, amountCents: null, propertyId: "", unitId: "", description: "" });

/**
 * Expense-line editor shared by bills and expenses: account, property/unit, amount per line,
 * plus "Split across properties" (equal, by units, by square feet or custom %).
 */
export function LinesEditor({ lines, onChange, options }: { lines: ExpenseLineDraft[]; onChange: (l: ExpenseLineDraft[]) => void; options: Pick<BooksOptions, "expenseAccounts" | "properties"> }) {
  const [splitOpen, setSplitOpen] = React.useState(false);
  const set = (key: number, patch: Partial<ExpenseLineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Lines</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">Account</th>
              <th scope="col" className="px-2 py-2 font-medium">Property</th>
              <th scope="col" className="px-2 py-2 font-medium">Unit</th>
              <th scope="col" className="px-2 py-2 font-medium">Description</th>
              <th scope="col" className="w-32 px-2 py-2 font-medium">Amount</th>
              <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const units = options.properties.find((p) => p.id === l.propertyId)?.unitList ?? [];
              return (
                <tr key={l.key} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <NativeSelect aria-label={`Account, line ${i + 1}`} value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })}>
                      <option value="">Choose…</option>
                      {options.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5">
                    <NativeSelect aria-label={`Property, line ${i + 1}`} value={l.propertyId} onChange={(e) => set(l.key, { propertyId: e.target.value, unitId: "" })}>
                      <option value="">Company (no property)</option>
                      {options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5">
                    <NativeSelect aria-label={`Unit, line ${i + 1}`} value={l.unitId} disabled={!units.length} onChange={(e) => set(l.key, { unitId: e.target.value })}>
                      <option value="">—</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </NativeSelect>
                  </td>
                  <td className="px-2 py-1.5"><Input aria-label={`Description, line ${i + 1}`} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><MoneyInput aria-label={`Amount, line ${i + 1}`} valueCents={l.amountCents} onChangeCents={(c) => set(l.key, { amountCents: c })} /></td>
                  <td className="px-2 py-1.5">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}><Trash2 aria-hidden /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border bg-surface-muted/40 font-medium">
            <tr><td className="px-2 py-2" colSpan={4}>Total</td><td className="px-2 py-2 text-right tabular">{formatMoney(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...lines, blankLine(lines[0]?.accountId)])}><Plus aria-hidden /> Add line</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setSplitOpen(true)}><Split aria-hidden /> Split across properties</Button>
      </div>
      <SplitDialog open={splitOpen} onOpenChange={setSplitOpen} options={options} defaults={{ accountId: lines[0]?.accountId ?? "", totalCents: total || null, description: lines[0]?.description ?? "" }} onApply={(l) => onChange(l)} />
    </div>
  );
}

function SplitDialog({ open, onOpenChange, options, defaults, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; options: Pick<BooksOptions, "expenseAccounts" | "properties">; defaults: { accountId: string; totalCents: number | null; description: string }; onApply: (l: ExpenseLineDraft[]) => void }) {
  const [accountId, setAccountId] = React.useState(defaults.accountId);
  const [total, setTotal] = React.useState<number | null>(defaults.totalCents);
  const [method, setMethod] = React.useState<SplitMethod>("EQUAL");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [pct, setPct] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) { setAccountId(defaults.accountId); setTotal(defaults.totalCents); }
  }, [open, defaults.accountId, defaults.totalCents]);
  const targets = options.properties.filter((p) => picked.includes(p.id)).map((p) => ({ id: p.id, label: p.name, units: p.units, sqft: p.sqft, percent: Number(pct[p.id] ?? 0) }));
  let preview: { id: string; amountCents: number }[] = [];
  let error = "";
  try {
    if (total && targets.length) preview = splitAmount(total, targets, method);
  } catch (e) {
    error = e instanceof Error ? e.message : "Can't split";
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Split across properties</DialogTitle>
          <DialogDescription>Replaces the lines with one line per property. Rounding always adds up to the total.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account" required>{(a) => <NativeSelect {...a} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose…</option>{options.expenseAccounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
            <Field label="Total to split" required>{(a) => <MoneyInput {...a} valueCents={total} onChangeCents={setTotal} />}</Field>
          </div>
          <Field label="Split by">{(a) => (
            <NativeSelect {...a} value={method} onChange={(e) => setMethod(e.target.value as SplitMethod)}>
              <option value="EQUAL">Equally</option>
              <option value="UNITS">Number of units</option>
              <option value="SQFT">Square feet</option>
              <option value="PERCENT">Custom percentages</option>
            </NativeSelect>
          )}</Field>
          <fieldset className="max-h-60 overflow-y-auto rounded-lg border border-border p-2">
            <legend className="px-1 text-sm font-medium">Properties</legend>
            {options.properties.map((p) => {
              const share = preview.find((x) => x.id === p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 py-1 text-sm">
                  <input id={`sp-${p.id}`} type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                  <label htmlFor={`sp-${p.id}`} className="flex-1">{p.name} <span className="text-xs text-muted-foreground">· {p.units} units{p.sqft ? ` · ${p.sqft.toLocaleString()} sq ft` : ""}</span></label>
                  {method === "PERCENT" && picked.includes(p.id) ? <Input aria-label={`Percent for ${p.name}`} className="w-20" inputMode="decimal" value={pct[p.id] ?? ""} onChange={(e) => setPct({ ...pct, [p.id]: e.target.value })} /> : null}
                  <span className="w-24 text-right tabular">{share ? formatMoney(share.amountCents) : ""}</span>
                </div>
              );
            })}
          </fieldset>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!preview.length || !accountId}
            onClick={() => {
              if (!accountId) return void toast.error("Choose an account");
              onApply(preview.filter((p) => p.amountCents > 0).map((p) => ({ ...blankLine(accountId), propertyId: p.id, amountCents: p.amountCents, description: defaults.description })));
              onOpenChange(false);
            }}
          >Apply split</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function linesPayload(lines: ExpenseLineDraft[]) {
  return lines.filter((l) => l.amountCents).map((l) => ({ accountId: l.accountId, amountCents: l.amountCents!, propertyId: l.propertyId || null, unitId: l.unitId || null, description: l.description || undefined }));
}
