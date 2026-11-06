"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { voidJournalEntry } from "@/server/actions/accounting";

export type EntryView = {
  id: string; date: string; memo: string; source: string; totalCents: number; reversed: boolean; isReversal: boolean;
  lines: { account: string; debitCents: number; creditCents: number; property: string | null }[];
};

const SOURCE: Record<string, string> = {
  MANUAL: "Manual", LEASE_CHARGE: "Charge", LEASE_PAYMENT: "Payment", LEASE_CREDIT: "Credit", LEASE_DEPOSIT: "Deposit", LEASE_REFUND: "Refund",
  LEASE_RETURNED_PAYMENT: "Returned payment", LEASE_VOID: "Void", REVERSAL: "Reversal", PREPAID_APPLIED: "Prepaid applied", PREPAID_UNAPPLIED: "Prepaid unapplied",
};

export function JournalList({ entries, canVoid }: { entries: EntryView[]; canVoid: boolean }) {
  const router = useRouter();
  const [source, setSource] = React.useState("ALL");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [voiding, setVoiding] = React.useState<EntryView | null>(null);
  const [reason, setReason] = React.useState("");
  const shown = entries.filter((e) => source === "ALL" || e.source === source);
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <NativeSelect aria-label="Filter by source" className="w-auto" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="ALL">All sources</option>
          {Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
        <span className="ml-auto text-xs text-muted-foreground">Showing the latest {shown.length} entries</span>
      </div>
      <ul className="divide-y divide-border text-sm">
        {shown.map((e) => {
          const open = openId === e.id;
          return (
            <li key={e.id}>
              <div className="flex items-center gap-3 px-3 py-2">
                <button type="button" aria-expanded={open} aria-controls={`je-${e.id}`} onClick={() => setOpenId(open ? null : e.id)} className="flex flex-1 items-center gap-3 text-left">
                  <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                  <span className="w-24 shrink-0 tabular">{formatDate(e.date)}</span>
                  <Badge tone={e.source === "MANUAL" ? "primary" : "outline"}>{SOURCE[e.source] ?? e.source}</Badge>
                  <span className={`flex-1 truncate ${e.reversed ? "line-through text-muted-foreground" : ""}`}>{e.memo}</span>
                  <span className="tabular font-medium">{formatMoney(e.totalCents)}</span>
                </button>
                {canVoid && e.source === "MANUAL" && !e.reversed ? (
                  <Button variant="ghost" size="sm" onClick={() => { setVoiding(e); setReason(""); }}>Void</Button>
                ) : null}
              </div>
              {open ? (
                <table id={`je-${e.id}`} className="mb-2 ml-10 w-[calc(100%-3.5rem)] text-xs">
                  <caption className="sr-only">Lines</caption>
                  <thead className="text-left text-muted-foreground"><tr><th scope="col" className="py-1">Account</th><th scope="col" className="py-1">Property</th><th scope="col" className="py-1 text-right">Debit</th><th scope="col" className="py-1 text-right">Credit</th></tr></thead>
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1">{l.account}</td>
                        <td className="py-1">{l.property ?? "—"}</td>
                        <td className="py-1 text-right tabular">{l.debitCents ? formatMoney(l.debitCents) : ""}</td>
                        <td className="py-1 text-right tabular">{l.creditCents ? formatMoney(l.creditCents) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent role="alertdialog" aria-describedby="vje-desc">
          <DialogHeader>
            <DialogTitle>Void journal entry?</DialogTitle>
            <DialogDescription id="vje-desc">A reversing entry is posted dated today. The original stays on record.</DialogDescription>
          </DialogHeader>
          <DialogBody><Field label="Reason" required>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field></DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setVoiding(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              const r = await voidJournalEntry(voiding!.id, reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Entry voided");
              setVoiding(null);
              router.refresh();
            }}>Void entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
