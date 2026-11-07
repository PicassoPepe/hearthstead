import Link from "next/link";
import { requirePortal } from "@/server/portal/context";
import { portalHome, portalLedger } from "@/server/portal/queries";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { TX_LABEL } from "@/lib/leasing";

export const metadata = { title: "History" };

export default async function HistoryPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  if (!h) return null;
  const rows = h.settings.showLedger ? await portalLedger(ctx) : [];
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <nav aria-label="More" className="flex flex-wrap gap-2 text-sm">
        {[["Autopay", "/portal/tenant/autopay"], ["Payment methods", "/portal/tenant/methods"], ["Insurance", "/portal/tenant/insurance"], ["Messages", "/portal/tenant/messages"]].map(([l, href]) => (
          <Link key={href} href={href!} className="rounded-full border border-border px-3 py-1.5 font-medium hover:bg-surface-muted">{l}</Link>
        ))}
      </nav>
      {h.settings.showLedger ? (
        rows.length ? (
          <Card className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{r.memo || TX_LABEL[r.type]}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(r.date)} · {TX_LABEL[r.type]}</div>
                </div>
                <div className="text-right">
                  <div className={`tabular font-medium ${r.effectCents < 0 ? "text-success" : ""}`}>{r.effectCents < 0 ? "−" : ""}{formatMoney(r.amountCents)}</div>
                  <div className="text-xs tabular text-muted-foreground">Balance {formatMoney(r.balanceCents)}</div>
                </div>
              </div>
            ))}
          </Card>
        ) : <p className="text-muted-foreground">No transactions yet.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Your property shows payments only.</p>
          <Card className="divide-y divide-border">
            {h.recentPayments.map((p) => (
              <div key={p.id} className="flex justify-between px-4 py-3 text-sm"><span>{formatDate(p.date)}</span><span className="flex gap-2"><StatusBadge status={p.status} />{formatMoney(p.amountCents)}</span></div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
