"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, CreditCard, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { STATUS_LABEL } from "@/lib/payments";
import { settleMockPayments, simulatePayment } from "@/server/actions/payments";

export type IncomingRow = {
  id: string; date: string; tenant: string; lease: string; leaseId: string; methodType: string; amountCents: number; feeCents: number;
  status: string; origin: string; failureReason: string | null; expectedPayoutDate: string | null; events: { status: string; at: string; note: string | null }[];
};
const STEPS = ["INITIATED", "PROCESSING", "SUCCEEDED", "PAID_OUT"];
const fmtTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function IncomingPayments({ rows, mock, canSimulate }: { rows: IncomingRow[]; mock: boolean; canSimulate: boolean }) {
  const router = useRouter();
  const [status, setStatus] = React.useState("ALL");
  const [open, setOpen] = React.useState<string | null>(null);
  const shown = rows.filter((r) => status === "ALL" || r.status === status);
  if (!rows.length) return <EmptyState icon={<CreditCard />} title="No online payments yet" description="Payments tenants make in the portal (and autopay) appear here with their status from initiated to paid out." />;
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <NativeSelect aria-label="Filter by status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
        {mock && canSimulate ? (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={async () => {
            const r = await settleMockPayments();
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Mock processor: ${r.data.settled} settled, ${r.data.failed} failed, ${r.data.paidOut} paid out`);
            router.refresh();
          }}>Run mock settlement</Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border text-sm">
        {shown.map((r) => {
          const expanded = open === r.id;
          const reached = new Set(r.events.map((e) => e.status));
          return (
            <li key={r.id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted/50" aria-expanded={expanded} aria-controls={`pi-${r.id}`} onClick={() => setOpen(expanded ? null : r.id)}>
                <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden />
                <span className="w-24 shrink-0 tabular">{formatDate(r.date)}</span>
                {r.methodType === "CARD" ? <CreditCard className="size-4 text-muted-foreground" aria-label="Card" /> : <Building2 className="size-4 text-muted-foreground" aria-label="Bank (ACH)" />}
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.tenant}</span> <span className="text-muted-foreground">· {r.lease}</span></span>
                {r.origin === "AUTOPAY" ? <Badge tone="info">Autopay</Badge> : null}
                <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
                <span className="w-24 text-right tabular font-medium">{formatMoney(r.amountCents)}</span>
              </button>
              {expanded ? (
                <div id={`pi-${r.id}`} className="grid gap-3 px-10 pb-4">
                  <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Payment status timeline">
                    {(r.status === "FAILED" ? [...STEPS.slice(0, 2), "FAILED"] : STEPS).map((s, i, arr) => (
                      <li key={s} className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${reached.has(s) ? (s === "FAILED" ? "bg-danger-soft text-danger-soft-foreground" : "bg-primary-soft text-primary-soft-foreground") : "border border-border text-muted-foreground"}`}>
                          {reached.has(s) ? "✓ " : ""}{STATUS_LABEL[s]}
                        </span>
                        {i < arr.length - 1 ? <span aria-hidden className="h-px w-4 bg-border-strong" /> : null}
                      </li>
                    ))}
                  </ol>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {r.events.map((e, i) => <li key={i}>{fmtTime.format(new Date(e.at))} — {STATUS_LABEL[e.status]}{e.note ? `: ${e.note}` : ""}</li>)}
                  </ul>
                  <div className="text-xs">Convenience fee {formatMoney(r.feeCents)} (kept by the processor) · {r.expectedPayoutDate ? `Payout ${formatDate(r.expectedPayoutDate)}` : "Payout after it clears"}{r.failureReason ? ` · ${r.failureReason}` : ""}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="secondary" size="sm"><Link href={`/app/leasing/${r.leaseId}?tab=transactions`}>Open lease ledger</Link></Button>
                    {mock && canSimulate && r.status === "PROCESSING" ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={async () => { const x = await simulatePayment(r.id, "SUCCEEDED"); if (!x.ok) return void toast.error(x.error); toast.success("Marked succeeded"); router.refresh(); }}>Simulate: clears</Button>
                        <Button size="sm" variant="danger" onClick={async () => { const x = await simulatePayment(r.id, "FAILED"); if (!x.ok) return void toast.error(x.error); toast.success("Marked failed — the ledger payment was reversed"); router.refresh(); }}>Simulate: ACH return</Button>
                      </>
                    ) : null}
                    {mock && canSimulate && r.status === "SUCCEEDED" ? (
                      <Button size="sm" variant="secondary" onClick={async () => { const x = await simulatePayment(r.id, "PAID_OUT"); if (!x.ok) return void toast.error(x.error); toast.success("Marked paid out"); router.refresh(); }}>Simulate: paid out</Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
