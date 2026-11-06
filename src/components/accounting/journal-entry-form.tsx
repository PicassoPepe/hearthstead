"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { createJournalEntry } from "@/server/actions/accounting";
import { useCreateModal } from "@/components/create/create-modal";

type Row = { key: number; accountId: string; debit: number | null; credit: number | null; propertyId: string; memo: string };
let n = 0;
const blank = (): Row => ({ key: n++, accountId: "", debit: null, credit: null, propertyId: "", memo: "" });

/** Manual journal entry with live balance check: Post is disabled until debits == credits. */
export function JournalEntryForm({ accounts, properties, today }: { accounts: { id: string; label: string }[]; properties: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [date, setDate] = React.useState(today);
  const [memo, setMemo] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([blank(), blank()]);
  const [busy, setBusy] = React.useState(false);
  const dr = rows.reduce((s, r) => s + (r.debit ?? 0), 0);
  const cr = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const balanced = dr === cr && dr > 0;
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!balanced) return void toast.error("Debits and credits must be equal");
        if (rows.some((r) => (r.debit || r.credit) && !r.accountId)) return void toast.error("Choose an account on every line");
        setBusy(true);
        const res = await createJournalEntry({
          date, memo,
          lines: rows.filter((r) => r.debit || r.credit).map((r) => ({ accountId: r.accountId, debitCents: r.debit ?? 0, creditCents: r.credit ?? 0, propertyId: r.propertyId || undefined, memo: r.memo || undefined })),
        });
        setBusy(false);
        if (!res.ok) return void toast.error(res.error);
        toast.success(`Journal entry posted — ${formatMoney(dr)}`);
        if (modal) modal.close();
        else router.push("/app/accounting/journal-entries");
        router.refresh();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Memo" required className="sm:col-span-2">{(a) => <Input {...a} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Reclassify October utilities" />}</Field>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Journal lines</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium">Account</th>
              <th scope="col" className="px-2 py-2 font-medium">Property</th>
              <th scope="col" className="w-32 px-2 py-2 font-medium">Debit</th>
              <th scope="col" className="w-32 px-2 py-2 font-medium">Credit</th>
              <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <NativeSelect aria-label={`Account, line ${i + 1}`} value={r.accountId} onChange={(e) => set(r.key, { accountId: e.target.value })}>
                    <option value="">Choose…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </NativeSelect>
                </td>
                <td className="px-2 py-1.5">
                  <NativeSelect aria-label={`Property, line ${i + 1}`} value={r.propertyId} onChange={(e) => set(r.key, { propertyId: e.target.value })}>
                    <option value="">—</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </NativeSelect>
                </td>
                <td className="px-2 py-1.5"><MoneyInput aria-label={`Debit, line ${i + 1}`} valueCents={r.debit} onChangeCents={(c) => set(r.key, { debit: c, credit: c ? null : r.credit })} /></td>
                <td className="px-2 py-1.5"><MoneyInput aria-label={`Credit, line ${i + 1}`} valueCents={r.credit} onChangeCents={(c) => set(r.key, { credit: c, debit: c ? null : r.debit })} /></td>
                <td className="px-2 py-1.5">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 aria-hidden /></Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-surface-muted/40 text-sm font-medium">
            <tr>
              <td className="px-2 py-2" colSpan={2}>Totals</td>
              <td className="px-2 py-2 text-right tabular">{formatMoney(dr)}</td>
              <td className="px-2 py-2 text-right tabular">{formatMoney(cr)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows([...rows, blank()])}><Plus aria-hidden /> Add line</Button>
        <span aria-live="polite" className="ml-auto">
          {balanced ? <Badge tone="success">Balanced ✓</Badge> : <Badge tone="warning">Out of balance by {formatMoney(Math.abs(dr - cr))}</Badge>}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {modal ? <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button> : null}
        <Button type="submit" loading={busy} disabled={!balanced || memo.trim().length < 2}>Post entry</Button>
      </div>
    </form>
  );
}
