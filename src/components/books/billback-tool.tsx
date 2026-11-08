"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { postBillbackAction, previewBillbackAction } from "@/server/actions/books";

type Opt = { id: string; label: string };
type Preview = { property: string; expense: string; ledgerCents: number; billCents: number; recoverCents: number; ownerShareCents: number; alreadyBilled: boolean; lines: { leaseId: string; label: string; sqft: number; occupants: number; amountCents: number }[] };
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHODS = { SQFT: "By square feet", OCCUPANTS: "By occupants", EQUAL: "Equally per unit", SQFT_OCCUPANTS: "50% sq ft / 50% occupants" } as const;

export function BillbackTool({ properties, expenseAccounts, incomeAccounts, defaultExpense, defaultIncome, defaultPeriod }: { properties: Opt[] | { id: string; name: string }[]; expenseAccounts: Opt[]; incomeAccounts: Opt[]; defaultExpense: string; defaultIncome: string; defaultPeriod: string }) {
  const router = useRouter();
  const props = (properties as { id: string; name?: string; label?: string }[]).map((p) => ({ id: p.id, label: p.name ?? p.label ?? "" }));
  const [v, setV] = React.useState({ propertyId: props[0]?.id ?? "", period: defaultPeriod, expenseAccountId: defaultExpense, incomeAccountId: defaultIncome, method: "SQFT_OCCUPANTS" as keyof typeof METHODS, recoveryPct: "100", billCents: null as number | null, label: "Water & sewer" });
  const [p, setP] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => setP(null), [v]);
  const input = () => ({ propertyId: v.propertyId, period: v.period, expenseAccountId: v.expenseAccountId, incomeAccountId: v.incomeAccountId || undefined, method: v.method, recoveryPct: Number(v.recoveryPct), billCents: v.billCents, label: v.label });
  if (!props.length) return <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Billback applies to multi-unit properties — you don&apos;t have any yet.</p>;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Property" error={errors.propertyId}>{(a) => <NativeSelect {...a} value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value })}>{props.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
        <Field label="Month" error={errors.period}>{(a) => <Input {...a} type="month" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} />}</Field>
        <Field label="Utility">{(a) => <Input {...a} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />}</Field>
        <Field label="Expense account" error={errors.expenseAccountId}>{(a) => <NativeSelect {...a} value={v.expenseAccountId} onChange={(e) => setV({ ...v, expenseAccountId: e.target.value })}>{expenseAccounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
        <Field label="Bill amount" description="Leave empty to use what's in the ledger for that month." error={errors.billCents}>{(a) => <MoneyInput {...a} valueCents={v.billCents} onChangeCents={(c) => setV({ ...v, billCents: c })} />}</Field>
        <Field label="Split" error={errors.method}>{(a) => <NativeSelect {...a} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as keyof typeof METHODS })}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect>}</Field>
        <Field label="Recover (%)" description="The rest stays with the owner (common areas)." error={errors.recoveryPct}>{(a) => <Input {...a} inputMode="numeric" value={v.recoveryPct} onChange={(e) => setV({ ...v, recoveryPct: e.target.value })} />}</Field>
        <Field label="Charge to income account">{(a) => <NativeSelect {...a} value={v.incomeAccountId} onChange={(e) => setV({ ...v, incomeAccountId: e.target.value })}>{incomeAccounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" loading={busy === "p"} onClick={async () => {
          setBusy("p");
          const r = await previewBillbackAction(input());
          setBusy("");
          if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
          setErrors({});
          setP(r.data);
        }}>Preview split</Button>
        <Button disabled={!p || p.alreadyBilled || p.billCents <= 0 || !p.lines.length} loading={busy === "post"} onClick={async () => {
          setBusy("post");
          const r = await postBillbackAction(input());
          setBusy("");
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          setP(null);
          router.refresh();
        }}>Post charges</Button>
      </div>
      {p ? (
        <section aria-labelledby="bb-h" className="rounded-card border border-primary/30 bg-primary-soft/30 p-4">
          <h2 id="bb-h" className="font-semibold">{p.property} · {p.expense}</h2>
          <p className="mt-1 text-sm">Bill {money(p.billCents)}{v.billCents === null ? ` (from the ledger)` : ""} · tenants pay <strong>{money(p.recoverCents)}</strong> · owner keeps {money(p.ownerShareCents)}{p.alreadyBilled ? <span className="font-semibold text-danger"> · already billed for this month</span> : null}</p>
          <ul className="mt-3 grid gap-1 text-sm" data-testid="billback-preview">
            {p.lines.map((l) => <li key={l.leaseId} className="flex justify-between gap-2"><span>Unit {l.label} <span className="text-muted-foreground">· {l.sqft} sq ft · {l.occupants} occupant{l.occupants === 1 ? "" : "s"}</span></span><span className="tabular font-medium">{money(l.amountCents)}</span></li>)}
            {!p.lines.length ? <li className="text-muted-foreground">No leases were occupied that month.</li> : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
