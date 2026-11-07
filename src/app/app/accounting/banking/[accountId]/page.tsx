import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { Button } from "@/components/ui/button";
import { BankFeed } from "@/components/books/banking-views";
import { bankBalance, matchSuggestions } from "@/server/accounting/banking";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Bank account" };

export default async function BankAccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ accountId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const account = await ctx.db.account.findFirst({ where: { id: accountId, isBank: true }, include: { bankAccount: true } });
  if (!account) notFound();
  const tab = sp.tab === "register" ? "register" : "feed";
  const [balance, feed, sugg, cats, props, lines] = await Promise.all([
    bankBalance(ctx.db, accountId),
    ctx.db.bankTransaction.findMany({ where: { bankAccountId: accountId }, orderBy: { date: "desc" }, take: 500 }),
    matchSuggestions(ctx.db, accountId),
    ctx.db.account.findMany({ where: { active: true, isBank: false }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tab === "register"
      ? ctx.db.journalLine.findMany({ where: { accountId }, include: { journalEntry: { select: { date: true, memo: true, source: true } } }, orderBy: [{ journalEntry: { date: "desc" } }, { createdAt: "desc" }], take: 500 })
      : Promise.resolve([]),
  ]);
  const matchedIds = feed.map((f) => f.matchedLineId).filter((x): x is string => !!x);
  const matchedLines = await ctx.db.journalLine.findMany({ where: { id: { in: matchedIds } }, include: { journalEntry: { select: { memo: true, date: true } } } });
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/accounting/banking" className="hover:underline">← Banking</Link>}
        title={account.name}
        description={`${account.code}${account.bankAccount?.mask ? ` · ••${account.bankAccount.mask}` : ""} · ledger balance ${formatMoney(balance)}`}
        actions={<Button asChild variant="secondary"><Link href={`/app/accounting/reconcile/${account.id}`}>Reconcile</Link></Button>}
      />
      <EntityTabs base={`/app/accounting/banking/${account.id}`} active={tab} tabs={[{ id: "feed", label: "Bank feed", count: feed.filter((f) => f.status === "UNMATCHED").length }, { id: "register", label: "Register" }]} />
      {tab === "feed" ? (
        <BankFeed
          bankAccountId={account.id}
          canEdit={can(ctx.permissions, "accounting", "edit")}
          categories={cats.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
          properties={props}
          rows={feed.map((f) => {
            const m = matchedLines.find((l) => l.id === f.matchedLineId);
            return { id: f.id, date: toISODate(f.date), description: f.description, amountCents: f.amountCents, status: f.status, matched: m ? `${formatDate(m.journalEntry.date)} · ${m.journalEntry.memo ?? ""}` : null, suggestions: sugg.get(f.id) ?? [] };
          })}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Register</caption>
            <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2 font-medium">Date</th><th scope="col" className="px-3 py-2 font-medium">Memo</th><th scope="col" className="px-3 py-2 text-right font-medium">In</th><th scope="col" className="px-3 py-2 text-right font-medium">Out</th><th scope="col" className="px-3 py-2 font-medium">Cleared</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2">{formatDate(l.journalEntry.date)}</td>
                  <td className="px-3 py-2">{l.journalEntry.memo ?? l.journalEntry.source}</td>
                  <td className="px-3 py-2 text-right tabular">{l.debitCents ? formatMoney(l.debitCents) : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{l.creditCents ? formatMoney(l.creditCents) : ""}</td>
                  <td className="px-3 py-2">{l.reconciliationId ? "✓ Reconciled" : matchedIds.includes(l.id) ? "In feed" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
