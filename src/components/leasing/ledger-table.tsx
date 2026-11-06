"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { TX_LABEL } from "@/lib/leasing";
import { returnPayment, voidLeaseTransaction } from "@/server/actions/leasing";
import type { LedgerRow } from "@/server/leasing/queries";
import { cn } from "@/lib/utils";

const TONE: Record<string, "neutral" | "success" | "info" | "warning" | "danger"> = {
  CHARGE: "neutral", PAYMENT: "success", CREDIT: "info", DEPOSIT: "info", REFUND: "warning", RETURNED_PAYMENT: "danger",
};

/** Lease ledger with running balance, filters, and void / returned-payment actions (audited). */
export function LedgerTable({ rows, canVoid, today }: { rows: LedgerRow[]; canVoid: boolean; today: string }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState("ALL");
  const [voiding, setVoiding] = React.useState<LedgerRow | null>(null);
  const [returning, setReturning] = React.useState<LedgerRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [nsf, setNsf] = React.useState<number | null>(3500);
  const [date, setDate] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  const shown = rows.filter((r) => filter === "ALL" || (filter === "OPEN" ? (r.remainingCents ?? 0) > 0 : r.type === filter));

  if (rows.length === 0) return <EmptyState icon={<Receipt />} title="No transactions yet" description="Charges post automatically on each rent date. Use Post charge or Receive payment above to record anything else." />;

  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <NativeSelect aria-label="Filter transactions" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All transactions</option>
          <option value="OPEN">Open charges</option>
          {Object.entries(TX_LABEL).map(([v, l]) => <option key={v} value={v}>{l}s</option>)}
        </NativeSelect>
        <span className="ml-auto text-xs text-muted-foreground">{shown.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Lease ledger, newest first, with running balance</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 font-medium">Type</th>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Charges</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Payments</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const increases = r.type === "CHARGE" || r.type === "RETURNED_PAYMENT" || (r.type === "REFUND" && r.chargeKind === "PREPAID_REFUND");
              const isDeposit = r.type === "DEPOSIT" || (r.type === "REFUND" && r.chargeKind === "DEPOSIT_REFUND");
              return (
                <tr key={r.id} className={cn("border-t border-border", r.voided && "text-muted-foreground")}>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{formatDate(r.date)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TONE[r.type] ?? "neutral"}>{TX_LABEL[r.type] ?? r.type}</Badge>
                    {r.voided ? <Badge tone="outline" className="ml-1">Voided</Badge> : null}
                    {r.returned ? <Badge tone="danger" className="ml-1">Returned</Badge> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(r.voided && "line-through")}>{r.memo}</span>
                    {r.reference ? <span className="ml-1 text-xs text-muted-foreground">#{r.reference}</span> : null}
                    {r.voided && r.voidReason ? <div className="text-xs">Void reason: {r.voidReason}</div> : null}
                    {r.remainingCents && r.remainingCents > 0 && r.remainingCents < r.amountCents ? <div className="text-xs text-muted-foreground">{formatMoney(r.remainingCents)} still open</div> : null}
                    {isDeposit ? <div className="text-xs text-muted-foreground">Held separately — doesn&apos;t change the balance</div> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{increases || (isDeposit && r.type === "REFUND") ? formatMoney(r.amountCents) : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{!increases && !(isDeposit && r.type === "REFUND") ? formatMoney(r.amountCents) : ""}</td>
                  <td className={cn("px-3 py-2 text-right tabular font-medium", r.balanceCents > 0 && "text-danger")}>{formatMoney(r.balanceCents)}</td>
                  <td className="px-3 py-2">
                    {canVoid && !r.voided && r.type !== "RETURNED_PAYMENT" && !r.returned ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.memo}`}><MoreHorizontal aria-hidden /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {r.type === "PAYMENT" ? <DropdownMenuItem onSelect={() => { setReturning(r); setReason("NSF"); setDate(today); }}>Mark as returned (NSF)</DropdownMenuItem> : null}
                          <DropdownMenuItem destructive onSelect={() => { setVoiding(r); setReason(""); }}>Void…</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent role="alertdialog" aria-describedby="void-desc">
          <DialogHeader>
            <DialogTitle>Void {voiding ? (TX_LABEL[voiding.type] ?? "").toLowerCase() : ""}?</DialogTitle>
            <DialogDescription id="void-desc">A reversing journal entry is posted and the original stays on record. This is audit-logged.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Reason" required>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />}</Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setVoiding(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await voidLeaseTransaction(voiding!.id, reason);
                setBusy(false);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Transaction voided");
                setVoiding(null);
                router.refresh();
              }}
            >
              Void transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent aria-describedby="ret-desc">
          <DialogHeader>
            <DialogTitle>Mark payment as returned</DialogTitle>
            <DialogDescription id="ret-desc">The {returning ? formatMoney(returning.amountCents) : ""} payment is reversed and the charges it paid reopen.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Returned on">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="NSF fee" description="Set to $0 for no fee">{(a) => <MoneyInput {...a} valueCents={nsf} onChangeCents={setNsf} />}</Field>
            <Field label="Reason" className="sm:col-span-2">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReturning(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await returnPayment(returning!.id, { date, nsfFeeCents: nsf ?? 0, reason });
                setBusy(false);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Payment marked as returned");
                setReturning(null);
                router.refresh();
              }}
            >
              Mark as returned
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
