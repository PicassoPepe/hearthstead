"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useCreateModal } from "@/components/create/create-modal";
import { formatMoney } from "@/lib/money";
import type { BooksOptions } from "@/server/accounting/queries";
import { createBillAction, createExpenseAction, createTransferAction } from "@/server/actions/books";
import { LinesEditor, blankLine, linesPayload, type ExpenseLineDraft } from "./lines-editor";

const addDaysISO = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function useFinish(path: string) {
  const router = useRouter();
  const modal = useCreateModal();
  return () => {
    if (modal) modal.close();
    else router.push(path);
    router.refresh();
  };
}

function FormActions({ busy, label }: { busy: boolean; label: string }) {
  const modal = useCreateModal();
  return (
    <div className="flex justify-end gap-2">
      {modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}
      <Button type="submit" loading={busy}>{label}</Button>
    </div>
  );
}

/** New bill: vendor, dates, lines (with split helper), optional monthly repeat. */
export function BillForm({ options, preset = {} }: { options: BooksOptions; preset?: { vendorId?: string; propertyId?: string } }) {
  const finish = useFinish("/app/accounting/bills");
  const [vendorId, setVendorId] = React.useState(preset.vendorId ?? "");
  const [billNumber, setBillNumber] = React.useState("");
  const [billDate, setBillDate] = React.useState(options.today);
  const [dueDate, setDueDate] = React.useState(addDaysISO(options.today, 30));
  const [memo, setMemo] = React.useState("");
  const [repeat, setRepeat] = React.useState(false);
  const [lines, setLines] = React.useState<ExpenseLineDraft[]>([{ ...blankLine(), propertyId: preset.propertyId ?? "" }]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const total = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!vendorId) errs.vendorId = "Choose a vendor";
        if (!total) errs.lines = "Enter at least one amount";
        if (lines.some((l) => l.amountCents && !l.accountId)) errs.lines = "Choose an account on every line";
        setErrors(errs);
        if (Object.keys(errs).length) return void toast.error(Object.values(errs)[0]!);
        setBusy(true);
        const res = await createBillAction({ vendorId, billNumber: billNumber || undefined, billDate, dueDate, memo: memo || undefined, lines: linesPayload(lines), recurring: repeat ? { dayOfMonth: Number(billDate.slice(8, 10)) } : undefined });
        setBusy(false);
        if (!res.ok) { setErrors(res.fieldErrors ?? {}); return void toast.error(res.error); }
        toast.success(`${res.message} · ${formatMoney(total)}`);
        finish();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" required error={errors.vendorId}>{(a) => (
          <NativeSelect {...a} value={vendorId} onChange={(e) => {
            setVendorId(e.target.value);
            const def = options.vendors.find((v) => v.id === e.target.value)?.defaultExpenseAccountId;
            if (def) setLines(lines.map((l) => (l.accountId ? l : { ...l, accountId: def })));
          }}>
            <option value="">Choose…</option>
            {options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </NativeSelect>
        )}</Field>
        <Field label="Bill #">{(a) => <Input {...a} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Vendor's invoice number" />}</Field>
        <Field label="Bill date" required>{(a) => <Input {...a} type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />}</Field>
        <Field label="Due date" required error={errors.dueDate}>{(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label="Memo" className="sm:col-span-2">{(a) => <Input {...a} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
      </div>
      <LinesEditor lines={lines} onChange={setLines} options={options} />
      {errors.lines ? <p role="alert" className="text-sm text-danger">{errors.lines}</p> : null}
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={repeat} onCheckedChange={setRepeat} aria-label="Repeat monthly" />
        <span>Repeat monthly on day {Number(billDate.slice(8, 10)) || 1} <span className="text-muted-foreground">(created automatically each night)</span></span>
      </label>
      <FormActions busy={busy} label="Create bill" />
    </form>
  );
}

const METHODS = [["DEBIT_CARD", "Debit card"], ["CREDIT_CARD", "Credit card"], ["CHECK", "Check"], ["ACH", "ACH"], ["CASH", "Cash"]] as const;

/** Expense paid directly from a bank account (no bill). */
export function ExpenseForm({ options }: { options: BooksOptions }) {
  const finish = useFinish("/app/accounting/expenses");
  const operating = options.banks.find((b) => b.purpose !== "SECURITY_DEPOSIT")?.id ?? "";
  const [payee, setPayee] = React.useState("");
  const [vendorId, setVendorId] = React.useState("");
  const [date, setDate] = React.useState(options.today);
  const [bankAccountId, setBank] = React.useState(operating);
  const [method, setMethod] = React.useState("DEBIT_CARD");
  const [reference, setReference] = React.useState("");
  const [lines, setLines] = React.useState<ExpenseLineDraft[]>([blankLine()]);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const total = lines.reduce((s, l) => s + (l.amountCents ?? 0), 0);
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!payee.trim()) errs.payee = "Who was paid?";
        if (!total) errs.lines = "Enter at least one amount";
        if (lines.some((l) => l.amountCents && !l.accountId)) errs.lines = "Choose an account on every line";
        setErrors(errs);
        if (Object.keys(errs).length) return void toast.error(Object.values(errs)[0]!);
        setBusy(true);
        const res = await createExpenseAction({ payee, vendorId: vendorId || null, date, bankAccountId, method, reference: reference || undefined, lines: linesPayload(lines) });
        setBusy(false);
        if (!res.ok) { setErrors(res.fieldErrors ?? {}); return void toast.error(res.error); }
        toast.success(`Expense recorded · ${formatMoney(total)}`);
        finish();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payee" required error={errors.payee}>{(a) => <Input {...a} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Home Depot" />}</Field>
        <Field label="Vendor (optional)" description="Link to a vendor for 1099 totals">{(a) => (
          <NativeSelect {...a} value={vendorId} onChange={(e) => { setVendorId(e.target.value); const v = options.vendors.find((x) => x.id === e.target.value); if (v && !payee) setPayee(v.name); }}>
            <option value="">—</option>
            {options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </NativeSelect>
        )}</Field>
        <Field label="Date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Paid from" description="A bookkeeping account already in your chart. This does not connect a bank." required>{(a) => <NativeSelect {...a} value={bankAccountId} onChange={(e) => setBank(e.target.value)}>{options.banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
        <Field label="Method">{(a) => <NativeSelect {...a} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>}</Field>
        <Field label="Reference">{(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check # or receipt #" />}</Field>
      </div>
      <LinesEditor lines={lines} onChange={setLines} options={options} />
      {errors.lines ? <p role="alert" className="text-sm text-danger">{errors.lines}</p> : null}
      <FormActions busy={busy} label="Record expense" />
    </form>
  );
}

/** Move money between bank accounts. */
export function TransferForm({ options }: { options: BooksOptions }) {
  const finish = useFinish("/app/accounting/banking");
  const [from, setFrom] = React.useState(options.banks[0]?.id ?? "");
  const [to, setTo] = React.useState(options.banks[1]?.id ?? "");
  const [amount, setAmount] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(options.today);
  const [propertyId, setPropertyId] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!amount) { setErrors({ amountCents: "Enter an amount" }); return; }
        setBusy(true);
        const res = await createTransferAction({ fromAccountId: from, toAccountId: to, amountCents: amount, date, propertyId: propertyId || null, memo: memo || undefined });
        setBusy(false);
        if (!res.ok) { setErrors(res.fieldErrors ?? {}); return void toast.error(res.error); }
        toast.success(`Transferred ${formatMoney(amount)}`);
        finish();
      }}
    >
      <Field label="From" required>{(a) => <NativeSelect {...a} value={from} onChange={(e) => setFrom(e.target.value)}>{options.banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
      <Field label="To" required error={errors.toAccountId}>{(a) => <NativeSelect {...a} value={to} onChange={(e) => setTo(e.target.value)}>{options.banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
      <Field label="Amount" required error={errors.amountCents}>{(a) => <MoneyInput {...a} valueCents={amount} onChangeCents={setAmount} />}</Field>
      <Field label="Date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <Field label="Property (optional)">{(a) => <NativeSelect {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}><option value="">—</option>{options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
      <Field label="Memo">{(a) => <Input {...a} value={memo} onChange={(e) => setMemo(e.target.value)} />}</Field>
      <div className="sm:col-span-2"><FormActions busy={busy} label="Record transfer" /></div>
    </form>
  );
}
