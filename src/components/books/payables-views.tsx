"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { BILL_STATUS_LABEL } from "@/lib/accounting";
import type { BillRow } from "@/server/accounting/queries";
import {
  applyVendorCreditAction, createVendorCreditAction, payBillAction, payBillsAction, voidBillAction, voidBillPaymentAction, voidExpenseAction,
} from "@/server/actions/books";

type Bank = { id: string; label: string; purpose: string };
const PAY_METHODS = [["CHECK", "Check"], ["ACH", "ACH"], ["CARD", "Card"], ["CASH", "Cash"], ["TRANSFER", "Transfer"]] as const;

export function BillsTable({ rows, banks, canEdit, today }: { rows: BillRow[]; banks: Bank[]; canEdit: boolean; today: string }) {
  const router = useRouter();
  const [paying, setPaying] = React.useState<BillRow[] | null>(null);
  const columns = React.useMemo<ColumnDef<BillRow, unknown>[]>(() => [
    { accessorKey: "vendor", header: "Vendor", cell: ({ row }) => <Link href={`/app/accounting/bills/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.vendor}</Link> },
    { accessorKey: "number", header: "Bill #" },
    { accessorKey: "properties", header: "Property" },
    { accessorKey: "billDate", header: "Date", cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: "dueDate", header: "Due", cell: ({ row }) => <span className={row.original.overdue ? "font-medium text-danger" : ""}>{formatDate(row.original.dueDate)}{row.original.overdue ? " · overdue" : ""}</span> },
    { accessorKey: "totalCents", header: "Total", cell: ({ getValue }) => <span className="block text-right tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: "openCents", header: "Open", cell: ({ getValue }) => <span className="block text-right tabular font-medium">{formatMoney(getValue() as number)}</span> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.overdue ? "OVERDUE" : row.original.status} />, filterFn: (r, id, v: string[]) => !v?.length || v.includes(r.getValue(id) as string) },
  ], []);
  return (
    <>
      <DataTable
        tableId="bills"
        label="Bills"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search vendor, bill #, property"
        onRowClick={(r) => router.push(`/app/accounting/bills/${r.id}`)}
        initialSorting={[{ id: "dueDate", desc: false }]}
        filters={[{ columnId: "status", label: "Statuses", options: Object.entries(BILL_STATUS_LABEL).map(([value, label]) => ({ value, label })) }]}
        bulkActions={canEdit ? [{ label: "Pay selected", onRun: (sel) => { const open = sel.filter((b) => b.openCents > 0); if (!open.length) return void toast.error("Those bills are already paid"); setPaying(open); } }] : undefined}
        rowActions={(r) => [{ label: "Open", onSelect: () => router.push(`/app/accounting/bills/${r.id}`) }, ...(canEdit && r.openCents > 0 ? [{ label: "Pay", onSelect: () => setPaying([r]) }] : [])]}
        csvFileName="bills.csv"
        empty={<EmptyState icon={<Receipt />} title="No bills yet" description="Enter vendor invoices as bills to track what you owe and pay them in bulk." action={canEdit ? <Button asChild><Link href="/app/new/bill" scroll={false}>New bill</Link></Button> : undefined} />}
      />
      <PayBillsDialog bills={paying} onClose={() => setPaying(null)} banks={banks} today={today} />
    </>
  );
}

export function PayBillsDialog({ bills, onClose, banks, today }: { bills: { id: string; vendor: string; number: string; openCents: number }[] | null; onClose: () => void; banks: Bank[]; today: string }) {
  const router = useRouter();
  const [bank, setBank] = React.useState(banks.find((b) => b.purpose !== "SECURITY_DEPOSIT")?.id ?? "");
  const [date, setDate] = React.useState(today);
  const [method, setMethod] = React.useState("CHECK");
  const [amount, setAmount] = React.useState<number | null>(null);
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const single = bills?.length === 1 ? bills[0]! : null;
  React.useEffect(() => { setAmount(single?.openCents ?? null); }, [single]);
  const total = bills?.reduce((s, b) => s + b.openCents, 0) ?? 0;
  return (
    <Dialog open={!!bills} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{single ? `Pay ${single.vendor}` : `Pay ${bills?.length ?? 0} bills`}</DialogTitle>
          <DialogDescription>{single ? `Bill ${single.number} · ${formatMoney(single.openCents)} open` : `Each bill is paid in full: ${formatMoney(total)} total.`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Pay from" required>{(a) => <NativeSelect {...a} value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
          <Field label="Payment date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Method">{(a) => <NativeSelect {...a} value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>}</Field>
          {single ? (
            <>
              <Field label="Amount" required>{(a) => <MoneyInput {...a} valueCents={amount} onChangeCents={setAmount} />}</Field>
              <Field label="Check # / reference">{(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!bills) return;
            setBusy(true);
            const res = single
              ? await payBillAction({ billId: single.id, amountCents: amount ?? undefined, date, bankAccountId: bank, method, reference: reference || undefined })
              : await payBillsAction({ billIds: bills.map((b) => b.id), date, bankAccountId: bank, method });
            setBusy(false);
            if (!res.ok) return void toast.error(res.error);
            toast.success(single ? `Paid ${formatMoney(amount ?? 0)} to ${single.vendor}` : `Paid ${bills.length} bills · ${formatMoney(total)}`);
            onClose();
            router.refresh();
          }}>{single ? "Record payment" : `Pay ${formatMoney(total)}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ title, description, open, onClose, onConfirm, confirmLabel }: { title: string; description: string; open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<boolean>; confirmLabel: string }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent role="alertdialog">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <DialogBody><Field label="Reason" required>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field></DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); const ok = await onConfirm(reason); setBusy(false); if (ok) { setReason(""); onClose(); } }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BillActions({ bill, banks, today, canEdit, canDelete, payments, openCredits }: {
  bill: { id: string; vendor: string; number: string; openCents: number; status: string };
  banks: Bank[]; today: string; canEdit: boolean; canDelete: boolean;
  payments: { id: string; voided: boolean; amountCents: number; date: string }[];
  openCredits: { id: string; amountCents: number; date: string; memo: string | null }[];
}) {
  const router = useRouter();
  const [paying, setPaying] = React.useState(false);
  const [voiding, setVoiding] = React.useState(false);
  const [voidPayment, setVoidPayment] = React.useState<string | null>(null);
  const run = async (p: Promise<{ ok: boolean; error?: string; message?: string }>) => {
    const r = await p;
    if (!r.ok) { toast.error(r.error); return false; }
    toast.success(r.message ?? "Done");
    router.refresh();
    return true;
  };
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && bill.openCents > 0 ? <Button onClick={() => setPaying(true)}>Pay bill</Button> : null}
      {canEdit && bill.openCents > 0 ? openCredits.filter((c) => c.amountCents <= bill.openCents).map((c) => (
        <Button key={c.id} variant="secondary" onClick={() => run(applyVendorCreditAction(c.id, bill.id))}>Apply {formatMoney(c.amountCents)} credit</Button>
      )) : null}
      {canDelete && bill.status !== "VOID" ? <Button variant="ghost" onClick={() => setVoiding(true)}>Void bill</Button> : null}
      {canDelete ? payments.filter((p) => !p.voided).map((p) => <Button key={p.id} variant="ghost" size="sm" onClick={() => setVoidPayment(p.id)}>Void {formatMoney(p.amountCents)} payment ({formatDate(p.date)})</Button>) : null}
      <PayBillsDialog bills={paying ? [bill] : null} onClose={() => setPaying(false)} banks={banks} today={today} />
      <ReasonDialog open={voiding} onClose={() => setVoiding(false)} title="Void this bill?" description="A reversing entry removes it from payables. Void its payments first." confirmLabel="Void bill" onConfirm={(r) => run(voidBillAction(bill.id, r))} />
      <ReasonDialog open={!!voidPayment} onClose={() => setVoidPayment(null)} title="Void this payment?" description="The bill goes back to open and the bank entry is reversed." confirmLabel="Void payment" onConfirm={(r) => run(voidBillPaymentAction(voidPayment!, r))} />
    </div>
  );
}

// ---------------------------------------------------------------- expenses

export type ExpenseRow = { id: string; date: string; payee: string; accounts: string; properties: string; method: string; totalCents: number; voided: boolean };

export function ExpensesTable({ rows, canDelete }: { rows: ExpenseRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [voiding, setVoiding] = React.useState<ExpenseRow | null>(null);
  const columns = React.useMemo<ColumnDef<ExpenseRow, unknown>[]>(() => [
    { accessorKey: "date", header: "Date", cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: "payee", header: "Payee", cell: ({ row }) => <span className={row.original.voided ? "line-through text-muted-foreground" : "font-medium"}>{row.original.payee}</span> },
    { accessorKey: "accounts", header: "Category" },
    { accessorKey: "properties", header: "Property" },
    { accessorKey: "method", header: "Method", cell: ({ getValue }) => <Badge tone="outline">{String(getValue()).replace("_", " ").toLowerCase()}</Badge> },
    { accessorKey: "totalCents", header: "Amount", cell: ({ getValue }) => <span className="block text-right tabular">{formatMoney(getValue() as number)}</span> },
  ], []);
  return (
    <>
      <DataTable
        tableId="expenses" label="Expenses" data={rows} columns={columns} getRowId={(r) => r.id}
        searchPlaceholder="Search payee, category, property" initialSorting={[{ id: "date", desc: true }]} csvFileName="expenses.csv"
        rowActions={(r) => (canDelete && !r.voided ? [{ label: "Void", destructive: true, onSelect: () => setVoiding(r) }] : [])}
        empty={<EmptyState icon={<Receipt />} title="No expenses yet" description="Record card and check purchases paid directly from a bank account." action={<Button asChild><Link href="/app/new/expense" scroll={false}>New expense</Link></Button>} />}
      />
      <ReasonDialog open={!!voiding} onClose={() => setVoiding(null)} title="Void this expense?" description="A reversing entry is posted today." confirmLabel="Void expense" onConfirm={async (reason) => {
        const r = await voidExpenseAction(voiding!.id, reason);
        if (!r.ok) { toast.error(r.error); return false; }
        toast.success("Expense voided");
        router.refresh();
        return true;
      }} />
    </>
  );
}

// ---------------------------------------------------------------- vendor credits

export type CreditRow = { id: string; date: string; vendor: string; amountCents: number; account: string; property: string; memo: string; appliedTo: string | null; appliedBillId: string | null };

export function VendorCreditsView({ rows, vendors, accounts, properties, openBills, today, canEdit }: {
  rows: CreditRow[]; vendors: { id: string; name: string }[]; accounts: { id: string; label: string }[]; properties: { id: string; name: string }[];
  openBills: { id: string; vendorId: string; label: string }[]; today: string; canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ vendorId: "", date: today, amountCents: null as number | null, accountId: accounts[0]?.id ?? "", propertyId: "", memo: "", applyToBillId: "" });
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-3">
      {canEdit ? <div><Button onClick={() => setOpen(true)}>New vendor credit</Button></div> : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Vendor credits</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Date", "Vendor", "Account", "Property", "Memo", "Applied to", "Amount"].map((h) => <th key={h} scope="col" className={`px-3 py-2 font-medium ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{formatDate(r.date)}</td>
                <td className="px-3 py-2 font-medium">{r.vendor}</td>
                <td className="px-3 py-2">{r.account}</td>
                <td className="px-3 py-2">{r.property}</td>
                <td className="px-3 py-2">{r.memo}</td>
                <td className="px-3 py-2">{r.appliedBillId ? <Link className="text-primary hover:underline" href={`/app/accounting/bills/${r.appliedBillId}`}>{r.appliedTo}</Link> : <Badge tone="warning">Unapplied</Badge>}</td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(r.amountCents)}</td>
              </tr>
            )) : <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No vendor credits yet. Record refunds and credit memos from vendors here.</td></tr>}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New vendor credit</DialogTitle><DialogDescription>Reduces what you owe the vendor and the expense it refunds.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor" required>{(a) => <NativeSelect {...a} value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value, applyToBillId: "" })}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</NativeSelect>}</Field>
            <Field label="Date" required>{(a) => <Input {...a} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
            <Field label="Amount" required>{(a) => <MoneyInput {...a} valueCents={f.amountCents} onChangeCents={(c) => setF({ ...f, amountCents: c })} />}</Field>
            <Field label="Expense account" required>{(a) => <NativeSelect {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
            <Field label="Property">{(a) => <NativeSelect {...a} value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })}><option value="">—</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
            <Field label="Apply to bill">{(a) => <NativeSelect {...a} value={f.applyToBillId} onChange={(e) => setF({ ...f, applyToBillId: e.target.value })}><option value="">Leave unapplied</option>{openBills.filter((b) => b.vendorId === f.vendorId).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
            <Field label="Memo" className="sm:col-span-2">{(a) => <Input {...a} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />}</Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              if (!f.vendorId || !f.amountCents) return void toast.error("Choose a vendor and enter an amount");
              setBusy(true);
              const r = await createVendorCreditAction({ vendorId: f.vendorId, date: f.date, amountCents: f.amountCents, accountId: f.accountId, propertyId: f.propertyId || null, memo: f.memo || undefined, applyToBillId: f.applyToBillId || null });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Vendor credit recorded");
              setOpen(false);
              router.refresh();
            }}>Save credit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
