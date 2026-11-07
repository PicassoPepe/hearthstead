import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReconcileWorkspace, StartReconciliation, UndoReconciliationButton } from "@/components/books/banking-views";
import { bankAccounts } from "@/server/accounting/payables";
import { bankBalance, reconciliationWorkspace } from "@/server/accounting/banking";
import { formatMoney } from "@/lib/money";
import { endOfMonth, addMonths, formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Reconcile" };

export default async function ReconcilePage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const banks = await bankAccounts(ctx.db);
  const bank = banks.find((b) => b.id === accountId);
  if (!bank) notFound();
  const [open, history, balance] = await Promise.all([
    ctx.db.reconciliation.findFirst({ where: { bankAccountId: accountId, status: "IN_PROGRESS" } }),
    ctx.db.reconciliation.findMany({ where: { bankAccountId: accountId, status: "COMPLETED" }, orderBy: { statementDate: "desc" } }),
    bankBalance(ctx.db, accountId),
  ]);
  const ws = open ? await reconciliationWorkspace(ctx.db, open.id) : null;
  // Default to the month after the last reconciliation (or last month if never reconciled).
  const lastMonthEnd = history[0] ? endOfMonth(addMonths(history[0].statementDate, 1)) : endOfMonth(addMonths(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), -1));
  const canEdit = can(ctx.permissions, "accounting", "edit");
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/accounting/banking" className="hover:underline">← Banking</Link>}
        title={`Reconcile ${bank.name}`}
        description="Tick off each transaction that appears on your bank statement until the difference is zero."
      />
      <nav aria-label="Bank accounts" className="mb-4 flex flex-wrap gap-2">
        {banks.map((b) => <Link key={b.id} href={`/app/accounting/reconcile/${b.id}`} aria-current={b.id === accountId ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${b.id === accountId ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>{b.name}</Link>)}
      </nav>
      {ws ? (
        <>
          <p className="mb-3 text-sm">Statement ending {formatDate(ws.rec.statementDate)} · {canEdit ? <span className="text-muted-foreground">change the date or balance below to restart</span> : null}</p>
          {canEdit ? <div className="mb-4"><StartReconciliation bankAccountId={accountId} defaultDate={toISODate(ws.rec.statementDate)} suggestedBalance={balance} /></div> : null}
          <ReconcileWorkspace key={`${ws.rec.id}-${ws.rec.statementBalanceCents}-${toISODate(ws.rec.statementDate)}`} rec={{ id: ws.rec.id, statementDate: toISODate(ws.rec.statementDate), statementBalanceCents: ws.rec.statementBalanceCents, openingBalanceCents: ws.rec.openingBalanceCents }} lines={ws.lines} />
        </>
      ) : canEdit ? (
        <Card className="mb-6"><CardHeader><CardTitle>Start a reconciliation</CardTitle></CardHeader><CardContent><StartReconciliation bankAccountId={accountId} defaultDate={toISODate(lastMonthEnd)} suggestedBalance={balance} /></CardContent></Card>
      ) : null}
      <Card className="mt-6">
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent>
          {history.length ? (
            <ul className="divide-y divide-border text-sm">
              {history.map((h, i) => (
                <li key={h.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1">Statement {formatDate(h.statementDate)} · {formatMoney(h.statementBalanceCents)}</span>
                  <span className="text-muted-foreground">completed {h.completedAt ? formatDate(h.completedAt) : ""}</span>
                  {i === 0 && can(ctx.permissions, "accounting", "delete") ? <UndoReconciliationButton id={h.id} /> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No completed reconciliations yet.</p>}
        </CardContent>
      </Card>
    </>
  );
}
