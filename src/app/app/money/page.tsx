import Link from "next/link";
import { Banknote, FileMinus, HandCoins, Landmark, PlusCircle, Receipt, Wallet } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { BigActions, PageHelp } from "@/components/patterns/big-actions";
import { StatCard } from "@/components/patterns/stat-card";
import { listLeases, orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { startOfMonth } from "@/lib/dates";

export const metadata = { title: "Rent & Money" };

/** Plain-language money home: the common jobs as big buttons, then who owes rent. */
export default async function MoneyHome() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view") && !can(ctx.permissions, "leasing", "view")) return <Forbidden what="money" />;
  const today = await orgToday(ctx);
  const scope = ctx.membership.propertyScope;
  const [leases, collected, billsDue] = await Promise.all([
    listLeases(ctx, { status: { in: ["ACTIVE", "EVICTION"] } }),
    ctx.db.leaseTransaction.aggregate({ where: { type: "PAYMENT", voidedAt: null, date: { gte: startOfMonth(today), lte: today }, ...(scope.length ? { lease: { propertyId: { in: scope } } } : {}) }, _sum: { amountCents: true } }),
    ctx.db.bill.count({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } } }),
  ]);
  const owing = leases.filter((l) => l.balanceCents > 0).sort((a, b) => b.balanceCents - a.balanceCents);
  const canMoney = can(ctx.permissions, "accounting", "edit") || can(ctx.permissions, "leasing", "edit");
  return (
    <>
      <PageHeader icon={<Wallet aria-hidden />} title="Rent & Money" />
      <PageHelp>Record rent you receive, see who still owes, pay bills and pay owners. Everything you enter here keeps the books balanced automatically.</PageHelp>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Tenants who owe rent" value={owing.length} hint={formatMoney(owing.reduce((n, l) => n + l.balanceCents, 0))} />
        <StatCard label="Rent collected this month" value={formatMoney(collected._sum.amountCents ?? 0)} />
        <StatCard label="Bills waiting to be paid" value={billsDue} href="/app/accounting/bills" />
      </div>
      {canMoney ? (
        <section aria-labelledby="money-do" className="mb-8">
          <h2 id="money-do" className="mb-3 text-lg font-semibold">What do you want to do?</h2>
          <BigActions items={[
            { href: "/app/new/payment", label: "Record a rent payment", hint: "A tenant paid by check, cash or money order.", icon: Banknote, tone: "primary" },
            { href: "/app/new/charge", label: "Charge a tenant", hint: "Add a fee or an extra charge to someone's account.", icon: PlusCircle },
            { href: "/app/accounting/bills", label: "Pay a bill", hint: "Pay a repair company or other bill.", icon: Receipt },
            { href: "/app/new/expense", label: "Write down an expense", hint: "Something you already paid for.", icon: FileMinus },
            { href: "/app/accounting/distributions", label: "Pay the owners", hint: "Send owners their share of the rent.", icon: HandCoins },
            { href: "/app/accounting/banking", label: "Bank accounts", hint: "See money in and out of your bank.", icon: Landmark },
          ]} />
        </section>
      ) : null}
      <section aria-labelledby="money-owe">
        <h2 id="money-owe" className="mb-3 text-lg font-semibold">Who owes rent right now</h2>
        {owing.length === 0 ? (
          <p className="rounded-card border border-border bg-surface p-6 text-center text-muted-foreground">Everyone is paid up. 🎉</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface shadow-card" data-testid="who-owes">
            {owing.slice(0, 50).map((l) => (
              <li key={l.id}>
                <Link href={`/app/leasing/${l.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-muted/50">
                  <span className="min-w-0"><span className="block font-semibold">{l.tenants || "Tenant"}</span><span className="block text-sm text-muted-foreground">{l.label}</span></span>
                  <span className="text-lg font-semibold tabular text-danger">{formatMoney(l.balanceCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-6 text-sm text-muted-foreground">Need more? Bookkeeping tools (budgets, matching bank statements, closing the year) are in the menu under <strong>Rent &amp; Money</strong>.</p>
    </>
  );
}
