import Link from "next/link";
import { ArrowLeftRight, Landmark } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UndepositedFunds } from "@/components/books/banking-views";
import { bankAccounts } from "@/server/accounting/payables";
import { bankBalance, undepositedPayments } from "@/server/accounting/banking";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Banking" };

export default async function BankingPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const banks = await bankAccounts(ctx.db);
  const [balances, review, recs, und] = await Promise.all([
    Promise.all(banks.map((b) => bankBalance(ctx.db, b.id))),
    ctx.db.bankTransaction.groupBy({ by: ["bankAccountId"], where: { status: "UNMATCHED" }, _count: true }),
    ctx.db.reconciliation.findMany({ where: { status: "COMPLETED" }, orderBy: { statementDate: "desc" } }),
    undepositedPayments(ctx.db),
  ]);
  const canEdit = can(ctx.permissions, "accounting", "edit");
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Banking"
        description="Bank balances come from the ledger. Sync the bank feed to match what actually cleared."
        actions={canEdit ? <Button asChild variant="secondary"><Link href="/app/new/transfer" scroll={false}><ArrowLeftRight aria-hidden /> Transfer</Link></Button> : null}
      />
      <ul className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {banks.map((b, i) => {
          const last = recs.find((r) => r.bankAccountId === b.id);
          const n = review.find((r) => r.bankAccountId === b.id)?._count ?? 0;
          return (
            <li key={b.id} className="rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><Landmark className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <Link href={`/app/accounting/banking/${b.id}`} className="font-semibold hover:underline">{b.name}</Link>
                  <div className="text-xs text-muted-foreground">{b.code}{b.mask ? ` · ••${b.mask}` : ""} · {b.purpose === "SECURITY_DEPOSIT" ? "Security deposits" : "Operating"}</div>
                </div>
                {n ? <Badge tone="warning">{n} to review</Badge> : null}
              </div>
              <div className="mt-3 text-2xl font-semibold tabular">{formatMoney(balances[i]!)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{last ? `Reconciled through ${formatDate(last.statementDate)}` : "Never reconciled"}</div>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="secondary"><Link href={`/app/accounting/banking/${b.id}`}>Feed &amp; register</Link></Button>
                <Button asChild size="sm" variant="ghost"><Link href={`/app/accounting/reconcile/${b.id}`}>Reconcile</Link></Button>
              </div>
            </li>
          );
        })}
      </ul>
      <UndepositedFunds rows={und} banks={banks.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}`, purpose: b.purpose }))} today={toISODate(new Date())} canEdit={canEdit} />
    </>
  );
}
