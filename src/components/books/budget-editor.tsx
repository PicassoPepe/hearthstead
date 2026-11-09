"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Plus, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createBudgetAction, deleteBudgetAction, fillBudgetAction, saveBudgetAction } from "@/server/actions/books";
import type { FillSource } from "@/server/accounting/budgets";

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
export function BudgetGrid({ id, name, year, accounts, amounts, otherBudgets = [] }: { id: string; name: string; year: number; accounts: Acct[]; amounts: Record<string, number[]>; otherBudgets?: { id: string; label: string }[] }) {
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
  /** "Same every month": copy the row's first filled month into all 12 months. */
  const firstFilled = (acct: string) => vals[acct]!.find((x) => toCents(x) > 0) ?? "";
  const sameEveryMonth = (acct: string) => {
    const v = firstFilled(acct);
    if (!v) return;
    setVals({ ...vals, [acct]: Array(12).fill(v) });
    setDirty(true);
  };
  const sameEveryMonthAll = () => {
    const next = { ...vals };
    let n = 0;
    for (const a of accounts) {
      const v = firstFilled(a.id);
      if (v && next[a.id]!.some((x) => x !== v)) { next[a.id] = Array(12).fill(v); n++; }
    }
    setVals(next);
    if (n) setDirty(true);
    toast.success(n ? `${n} row${n === 1 ? "" : "s"} now use the same amount every month` : "Every row already has the same amount each month");
  };
  const [filled, setFilled] = React.useState<{ sources: FillSource[]; rows: number } | null>(null);
  const applyFill = (amounts: Record<string, number[]>, sources: FillSource[], mode: "replace" | "add") => {
    const next = { ...vals };
    let rows = 0;
    for (const [acct, months] of Object.entries(amounts)) {
      if (!next[acct]) continue;
      rows++;
      next[acct] = months.map((c, i) => {
        const cents = mode === "add" ? c + toCents(next[acct]![i] ?? "") : c;
        return toDollars(Math.round(cents / 100) * 100);
      });
    }
    setVals(next);
    setDirty(true);
    setFilled({ sources, rows });
  };
  const sum = (t: string, m: number) => accounts.filter((a) => a.type === t).reduce((n, a) => n + toCents(vals[a.id]![m] ?? ""), 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Budget name">{(a) => <Input {...a} className="w-72" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />}</Field>
        <span className="pb-2 text-sm text-muted-foreground" aria-live="polite">{dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <FillFromDialog id={id} year={year} otherBudgets={otherBudgets} onFill={applyFill} />
          <Button variant="secondary" onClick={sameEveryMonthAll}><Repeat aria-hidden /> Same every month (all rows)</Button>
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
      {filled ? (
        <div role="status" className="rounded-lg border border-primary/40 bg-primary-soft/40 p-3 text-sm" data-testid="budget-filled">
          <p className="font-semibold">Filled in {filled.rows} row{filled.rows === 1 ? "" : "s"}. Check the numbers, then press “Save budget”.</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {filled.sources.map((s) => <li key={s.key}>{s.label}: {(s.totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} for the year{s.accounts ? "" : " (nothing found)"}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full min-w-[1150px] text-sm">
          <caption className="sr-only">Monthly budget by account, in whole dollars</caption>
          <thead className="sticky top-0 bg-surface-muted/80 text-xs text-muted-foreground">
            <tr><th scope="col" className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">Account</th>{MONTHS.map((m) => <th key={m} scope="col" className="px-1 py-2 text-right font-medium">{m}</th>)}<th scope="col" className="px-3 py-2 text-right font-medium">Annual</th><th scope="col" className="px-2 py-2 font-medium"><span className="sr-only">Same every month</span></th></tr>
          </thead>
          <tbody>
            {(["INCOME", "EXPENSE"] as const).map((t) => (
              <React.Fragment key={t}>
                <tr className="border-t border-border bg-surface-muted/40"><th scope="rowgroup" colSpan={15} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t === "INCOME" ? "Income" : "Expenses"}</th></tr>
                {accounts.filter((a) => a.type === t).map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <th scope="row" className="sticky left-0 bg-surface px-3 py-1 text-left font-medium whitespace-nowrap">{a.code} · {a.name}</th>
                    {MONTHS.map((m, i) => (
                      <td key={m} className="px-0.5 py-1"><input aria-label={`${a.name}, ${m}`} inputMode="numeric" className="h-8 w-[72px] rounded-md border border-input bg-surface px-1.5 text-right tabular text-sm focus:outline-2 focus:outline-ring" value={vals[a.id]![i]} onChange={(e) => set(a.id, i, e.target.value)} /></td>
                    ))}
                    <td className="px-1 py-1"><input aria-label={`${a.name}, annual total (spreads evenly)`} inputMode="numeric" className="h-8 w-24 rounded-md border border-input bg-surface-muted/50 px-1.5 text-right tabular text-sm font-semibold focus:outline-2 focus:outline-ring" key={annual(a.id)} defaultValue={annual(a.id) ? (annual(a.id) / 100).toFixed(0) : ""} onBlur={(e) => { if (toCents(e.target.value) !== annual(a.id)) spreadAnnual(a.id, e.target.value); }} /></td>
                    <td className="px-1 py-1"><Button size="sm" variant="ghost" title="Use the first month's amount for every month" aria-label={`Same every month for ${a.name}`} disabled={!firstFilled(a.id)} onClick={() => sameEveryMonth(a.id)}><Repeat aria-hidden /><span className="hidden xl:inline">Same every month</span></Button></td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-surface-muted/30 font-semibold">
                  <th scope="row" className="sticky left-0 bg-surface-muted px-3 py-1.5 text-left">Total {t === "INCOME" ? "income" : "expenses"}</th>
                  {MONTHS.map((m, i) => <td key={m} className="px-1.5 py-1.5 text-right tabular">{(sum(t, i) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>)}
                  <td className="px-3 py-1.5 text-right tabular">{(MONTHS.reduce((n, _m, i) => n + sum(t, i), 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                  <td />
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Whole dollars. Type an amount in the first month and press “Same every month” to repeat it all year — or type a yearly total in “Annual” to split it evenly over the months.</p>
    </div>
  );
}

/** "Fill in from…": pull numbers from leases, repeating bills, last year or another budget. */
function FillFromDialog({ id, year, otherBudgets, onFill }: { id: string; year: number; otherBudgets: { id: string; label: string }[]; onFill: (amounts: Record<string, number[]>, sources: FillSource[], mode: "replace" | "add") => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [o, setO] = React.useState({ leases: true, assumeRenew: true, bills: true, lastYear: false, adjust: "3", copy: "", mode: "replace" as "replace" | "add" });
  const box = (k: "leases" | "assumeRenew" | "bills" | "lastYear", label: string, hint: string, indent = false) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/30 ${indent ? "ml-7" : ""}`}>
      <input type="checkbox" className="mt-1 size-4 accent-[var(--color-primary)]" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} />
      <span><span className="block font-medium">{label}</span><span className="block text-sm text-muted-foreground">{hint}</span></span>
    </label>
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}><Download aria-hidden /> Fill in from…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" aria-describedby="fill-desc">
          <DialogHeader>
            <DialogTitle>Fill in the budget</DialogTitle>
            <DialogDescription id="fill-desc">Pick where to get the numbers. Nothing is saved until you press “Save budget”, so you can check everything first.</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await fillBudgetAction(id, { leases: o.leases, assumeRenew: o.leases && o.assumeRenew, bills: o.bills, lastYear: o.lastYear, adjustPct: Number(o.adjust) || 0, copyBudgetId: o.copy || null });
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            onFill(r.data.amounts, r.data.sources, o.mode);
            setOpen(false);
            toast.success("Budget filled in — check it, then press Save budget");
          }}>
            <DialogBody className="grid gap-2">
              {box("leases", "Rent from your leases", `Each tenant's rent and other monthly charges (pet rent, parking…) for the months of ${year} they apply.`)}
              {o.leases ? box("assumeRenew", "Assume leases renew", "Keep counting rent after a lease's end date, at the same amount.", true) : null}
              {box("bills", "Repeating bills", "Bills set up to repeat every month (lawn care, trash, insurance…).")}
              {box("lastYear", `Last year (${year - 1})`, "What actually came in and went out last year, month by month.")}
              {o.lastYear ? <Field label="Change last year's numbers by (%)" className="ml-7" description="For example 3 to add 3% for rising costs.">{(a) => <Input {...a} inputMode="decimal" className="w-28" value={o.adjust} onChange={(e) => setO({ ...o, adjust: e.target.value })} />}</Field> : null}
              {otherBudgets.length ? (
                <Field label="Copy another budget (optional)">{(a) => (
                  <NativeSelect {...a} value={o.copy} onChange={(e) => setO({ ...o, copy: e.target.value })}>
                    <option value="">Don&apos;t copy a budget</option>
                    {otherBudgets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </NativeSelect>
                )}</Field>
              ) : null}
              <fieldset className="mt-2">
                <legend className="mb-1 text-sm font-medium">What should happen to numbers already in the budget?</legend>
                <div className="grid gap-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="fill-mode" checked={o.mode === "replace"} onChange={() => setO({ ...o, mode: "replace" })} /> Replace them (only rows that get new numbers)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="fill-mode" checked={o.mode === "add"} onChange={() => setO({ ...o, mode: "add" })} /> Add the new numbers on top</label>
                </div>
              </fieldset>
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Fill in</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
