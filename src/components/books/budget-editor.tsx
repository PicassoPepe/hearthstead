"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createBudgetAction, deleteBudgetAction, saveBudgetAction } from "@/server/actions/books";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function NewBudgetButton({ properties, defaultYear, canCompany }: { properties: { id: string; name: string }[]; defaultYear: number; canCompany: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [v, setV] = React.useState({ name: `${defaultYear + 1} operating budget`, year: String(defaultYear + 1), propertyId: canCompany ? "" : properties[0]?.id ?? "", start: "LAST_YEAR" as "BLANK" | "LAST_YEAR", adjust: "3" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus aria-hidden /> New budget</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="nb-desc">
          <DialogHeader><DialogTitle>New budget</DialogTitle><DialogDescription id="nb-desc">Start from last year&apos;s actuals (optionally adjusted) or from scratch.</DialogDescription></DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await createBudgetAction({ name: v.name, year: Number(v.year), propertyId: v.propertyId || null, start: v.start, adjustPct: Number(v.adjust) || 0 });
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            toast.success("Budget created");
            router.push(`/app/accounting/budgets/${r.data.id}?tab=edit`);
          }}>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.name} className="sm:col-span-2">{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <Field label="Year" error={errors.year}>{(a) => <Input {...a} inputMode="numeric" value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} />}</Field>
              <Field label="For">{(a) => <NativeSelect {...a} value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value })}>{canCompany ? <option value="">Whole company</option> : null}{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
              <Field label="Start from">{(a) => <NativeSelect {...a} value={v.start} onChange={(e) => setV({ ...v, start: e.target.value as "BLANK" | "LAST_YEAR" })}><option value="LAST_YEAR">Last year&apos;s actuals</option><option value="BLANK">Blank</option></NativeSelect>}</Field>
              {v.start === "LAST_YEAR" ? <Field label="Adjust by (%)">{(a) => <Input {...a} inputMode="decimal" value={v.adjust} onChange={(e) => setV({ ...v, adjust: e.target.value })} />}</Field> : null}
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Create budget</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Acct = { id: string; code: string; name: string; type: string };
const toDollars = (c: number) => (c ? (c / 100).toFixed(0) : "");
const toCents = (s: string) => Math.max(0, Math.round((Number(s.replace(/[^0-9.]/g, "")) || 0) * 100));

/** Account × month grid (whole dollars). Edit the annual total to spread it evenly. */
export function BudgetGrid({ id, name, accounts, amounts }: { id: string; name: string; accounts: Acct[]; amounts: Record<string, number[]> }) {
  const router = useRouter();
  const [vals, setVals] = React.useState<Record<string, string[]>>(() => Object.fromEntries(accounts.map((a) => [a.id, (amounts[a.id] ?? Array(12).fill(0)).map(toDollars)])));
  const [title, setTitle] = React.useState(name);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const set = (acct: string, m: number, s: string) => { setVals({ ...vals, [acct]: vals[acct]!.map((x, i) => (i === m ? s : x)) }); setDirty(true); };
  const annual = (acct: string) => vals[acct]!.reduce((n, x) => n + toCents(x), 0);
  const spreadAnnual = (acct: string, s: string) => {
    const total = toCents(s);
    const base = Math.floor(total / 100 / 12);
    const rem = Math.round(total / 100) - base * 12;
    setVals({ ...vals, [acct]: Array.from({ length: 12 }, (_, i) => String(base + (i < rem ? 1 : 0) || "")) });
    setDirty(true);
  };
  const sum = (t: string, m: number) => accounts.filter((a) => a.type === t).reduce((n, a) => n + toCents(vals[a.id]![m] ?? ""), 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Budget name">{(a) => <Input {...a} className="w-72" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />}</Field>
        <span className="pb-2 text-sm text-muted-foreground" aria-live="polite">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={async () => {
            if (!confirm("Delete this budget?")) return;
            const r = await deleteBudgetAction(id);
            if (!r.ok) return void toast.error(r.error);
            router.push("/app/accounting/budgets");
          }}><Trash2 aria-hidden /> Delete</Button>
          <Button loading={busy} disabled={!dirty} onClick={async () => {
            setBusy(true);
            const r = await saveBudgetAction(id, Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.map(toCents)])), title);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            setDirty(false);
            toast.success("Budget saved");
            router.refresh();
          }}>Save budget</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full min-w-[1100px] text-sm">
          <caption className="sr-only">Monthly budget by account, in whole dollars</caption>
          <thead className="sticky top-0 bg-surface-muted/80 text-xs text-muted-foreground">
            <tr><th scope="col" className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">Account</th>{MONTHS.map((m) => <th key={m} scope="col" className="px-1 py-2 text-right font-medium">{m}</th>)}<th scope="col" className="px-3 py-2 text-right font-medium">Annual</th></tr>
          </thead>
          <tbody>
            {(["INCOME", "EXPENSE"] as const).map((t) => (
              <React.Fragment key={t}>
                <tr className="border-t border-border bg-surface-muted/40"><th scope="rowgroup" colSpan={14} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t === "INCOME" ? "Income" : "Expenses"}</th></tr>
                {accounts.filter((a) => a.type === t).map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <th scope="row" className="sticky left-0 bg-surface px-3 py-1 text-left font-medium whitespace-nowrap">{a.code} · {a.name}</th>
                    {MONTHS.map((m, i) => (
                      <td key={m} className="px-0.5 py-1"><input aria-label={`${a.name}, ${m}`} inputMode="numeric" className="h-8 w-[72px] rounded-md border border-input bg-surface px-1.5 text-right tabular text-sm focus:outline-2 focus:outline-ring" value={vals[a.id]![i]} onChange={(e) => set(a.id, i, e.target.value)} /></td>
                    ))}
                    <td className="px-1 py-1"><input aria-label={`${a.name}, annual total (spreads evenly)`} inputMode="numeric" className="h-8 w-24 rounded-md border border-input bg-surface-muted/50 px-1.5 text-right tabular text-sm font-semibold focus:outline-2 focus:outline-ring" key={annual(a.id)} defaultValue={annual(a.id) ? (annual(a.id) / 100).toFixed(0) : ""} onBlur={(e) => { if (toCents(e.target.value) !== annual(a.id)) spreadAnnual(a.id, e.target.value); }} /></td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-surface-muted/30 font-semibold">
                  <th scope="row" className="sticky left-0 bg-surface-muted px-3 py-1.5 text-left">Total {t === "INCOME" ? "income" : "expenses"}</th>
                  {MONTHS.map((m, i) => <td key={m} className="px-1.5 py-1.5 text-right tabular">{(sum(t, i) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>)}
                  <td className="px-3 py-1.5 text-right tabular">{(MONTHS.reduce((n, _m, i) => n + sum(t, i), 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Whole dollars. Type an annual total to spread it evenly across the months.</p>
    </div>
  );
}
