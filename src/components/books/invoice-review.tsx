"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approveVendorInvoiceAction, rejectVendorInvoiceAction } from "@/server/actions/books";

export type InvoiceRow = { id: string; vendor: string; invoiceNumber: string; invoiceDate: string; amountCents: number; description: string; workOrder: string | null; propertyId: string | null; attachmentId: string | null; defaultAccountId: string };
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InvoiceReview({ rows, accounts, properties, defaultDue }: { rows: InvoiceRow[]; accounts: { id: string; label: string }[]; properties: { id: string; name: string }[]; defaultDue: string }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<{ row: InvoiceRow; action: "approve" | "reject" } | null>(null);
  const [v, setV] = React.useState({ accountId: "", propertyId: "", dueDate: defaultDue, note: "" });
  const [busy, setBusy] = React.useState(false);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="inv-h" className="mb-4 rounded-card border border-info/40 bg-info-soft/40 p-4">
      <h2 id="inv-h" className="mb-2 font-semibold">Vendor invoices to review ({rows.length})</h2>
      <ul className="grid gap-2" data-testid="invoices-to-review">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
            <span className="min-w-0 flex-1"><span className="font-semibold">{r.vendor}</span> · #{r.invoiceNumber} · <span className="tabular">{money(r.amountCents)}</span><span className="block truncate text-muted-foreground">{r.workOrder ? `${r.workOrder} — ` : ""}{r.description}</span></span>
            {r.attachmentId ? <a className="text-primary hover:underline" href={`/api/files/${r.attachmentId}`} target="_blank" rel="noopener">View invoice</a> : null}
            <Button size="sm" onClick={() => { setV({ accountId: r.defaultAccountId, propertyId: r.propertyId ?? "", dueDate: defaultDue, note: "" }); setMode({ row: r, action: "approve" }); }}>Approve…</Button>
            <Button size="sm" variant="ghost" onClick={() => { setV({ ...v, note: "" }); setMode({ row: r, action: "reject" }); }}>Return</Button>
          </li>
        ))}
      </ul>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent aria-describedby="ir-desc">
          <DialogHeader>
            <DialogTitle>{mode?.action === "approve" ? `Approve invoice #${mode.row.invoiceNumber}` : `Return invoice #${mode?.row.invoiceNumber}`}</DialogTitle>
            <DialogDescription id="ir-desc">{mode?.action === "approve" ? "Creates a bill for this amount (Dr expense, Cr Accounts Payable). Large bills may need owner approval before payment." : "The vendor sees your note and can resubmit."}</DialogDescription>
          </DialogHeader>
          <form className="contents" onSubmit={async (e) => {
            e.preventDefault();
            if (!mode) return;
            setBusy(true);
            const r = mode.action === "approve" ? await approveVendorInvoiceAction(mode.row.id, { accountId: v.accountId, propertyId: v.propertyId || null, dueDate: v.dueDate }) : await rejectVendorInvoiceAction(mode.row.id, v.note);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            setMode(null);
            router.refresh();
          }}>
            <DialogBody className="grid gap-4">
              {mode?.action === "approve" ? (
                <>
                  <Field label="Expense account">{(a) => <NativeSelect {...a} value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
                  <Field label="Property">{(a) => <NativeSelect {...a} value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value })}><option value="">Company (no property)</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
                  <Field label="Due date">{(a) => <Input {...a} type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />}</Field>
                </>
              ) : (
                <Field label="Note to the vendor" required>{(a) => <Textarea {...a} rows={3} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />}</Field>
              )}
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button><Button type="submit" loading={busy}>{mode?.action === "approve" ? "Approve & create bill" : "Return to vendor"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
