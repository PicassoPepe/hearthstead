import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { StatCard } from "@/components/patterns/stat-card";
import { BudgetGrid } from "@/components/books/budget-editor";
import { budgetVsActual } from "@/server/accounting/budgets";
import { orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Budget" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function BudgetPage({ params, searchParams }: { params: Promise<{ budgetId: string }>; searchParams: Promise<{ tab?: string; through?: string }> }) {
  const [{ budgetId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="budgets" />;
  const today = await orgToday(ctx);
  const b0 = await ctx.db.budget.findFirst({ where: { id: budgetId } });
  if (!b0 || (b0.propertyId && ctx.membership.propertyScope.length && !ctx.membership.propertyScope.includes(b0.propertyId))) notFound();
  const defaultThrough = b0.year < today.getUTCFullYear() ? 11 : b0.year > today.getUTCFullYear() ? 0 : today.getUTCMonth();
  const through = Math.min(11, Math.max(0, sp.through ? Number(sp.through) : defaultThrough));
  const d = (await budgetVsActual(ctx, budgetId, through))!;
  const prop = d.budget.propertyId ? await ctx.db.property.findFirst({ where: { id: d.budget.propertyId }, select: { name: true } }) : null;
  const tab = sp.tab === "edit" ? "edit" : "actual";
  const net = { budget: d.totals.income.budget - d.totals.expense.budget, actual: d.totals.income.actual - d.totals.expense.actual };
  const canEdit = can(ctx.permissions, "accounting", "edit");

  return (
    <>
      <PageHeader eyebrow={<Link href="/app/accounting/budgets" className="hover:underline">← Budgets</Link>} title={d.budget.name} description={`${d.budget.year} · ${prop?.name ?? "Company-wide"} · accrual actuals from the ledger`} />
      <EntityTabs base={`/app/accounting/budgets/${budgetId}`} active={tab} tabs={[{ id: "actual", label: "Budget vs actual" }, ...(canEdit ? [{ id: "edit", label: "Edit budget" }] : [])]} />
      {tab === "edit" && canEdit ? (
        <BudgetGrid id={budgetId} name={d.budget.name} year={d.budget.year} accounts={d.accounts} amounts={d.budget.amounts as Record<string, number[]>}
          otherBudgets={(await ctx.db.budget.findMany({ where: { id: { not: budgetId }, ...(ctx.membership.propertyScope.length ? { propertyId: { in: ctx.membership.propertyScope } } : {}) }, orderBy: [{ year: "desc" }, { name: "asc" }], select: { id: true, name: true, year: true } })).map((o) => ({ id: o.id, label: `${o.name} (${o.year})` }))} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Year to date through</span>
            {MONTHS.map((m, i) => <Link key={m} href={`?through=${i}`} aria-current={i === through ? "true" : undefined} className={cn("rounded-md px-2 py-1", i === through ? "bg-primary-soft font-semibold text-primary-soft-foreground" : "text-muted-foreground hover:bg-surface-muted")}>{m}</Link>)}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Income vs budget" value={formatMoney(d.totals.income.actual)} hint={`Budget ${formatMoney(d.totals.income.budget)}`} />
            <StatCard label="Expenses vs budget" value={formatMoney(d.totals.expense.actual)} hint={`Budget ${formatMoney(d.totals.expense.budget)}`} />
            <StatCard label="Net income" value={formatMoney(net.actual)} hint={`Budget ${formatMoney(net.budget)}`} />
            <StatCard label="Variance (net)" value={<span className={net.actual - net.budget < 0 ? "text-danger" : "text-success"}>{formatMoney(net.actual - net.budget)}</span>} hint={net.actual - net.budget < 0 ? "Unfavorable" : "Favorable"} />
          </div>
          <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Budget vs actual, year to date through {MONTHS[through]}</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Account", "Budget YTD", "Actual YTD", "Variance", "%", "Annual budget"].map((h, i) => <th key={h} scope="col" className={cn("px-3 py-2 font-medium", i && "text-right")}>{h}</th>)}</tr></thead>
              <tbody>
                {(["INCOME", "EXPENSE"] as const).map((t) => (
                  <Fragment key={t}>
                    <tr className="border-t border-border bg-surface-muted/40"><th scope="rowgroup" colSpan={6} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t === "INCOME" ? "Income" : "Expenses"}</th></tr>
                    {d.rows.filter((r) => r.type === t).map((r) => {
                      const pct = r.budgetYtd ? (r.varianceYtd / r.budgetYtd) * 100 : null;
                      return (
                        <tr key={r.accountId} className="border-t border-border">
                          <th scope="row" className="px-3 py-2 text-left font-medium">{r.code} · {r.name}</th>
                          <td className="px-3 py-2 text-right tabular">{formatMoney(r.budgetYtd)}</td>
                          <td className="px-3 py-2 text-right tabular">{formatMoney(r.actualYtd)}</td>
                          <td className={cn("px-3 py-2 text-right tabular font-medium", r.varianceYtd < 0 ? "text-danger" : "text-success")}>{r.varianceYtd < 0 ? "▼ " : "▲ "}{formatMoney(Math.abs(r.varianceYtd))}<span className="sr-only">{r.varianceYtd < 0 ? " unfavorable" : " favorable"}</span></td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">{pct === null ? "—" : `${pct.toFixed(0)}%`}</td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatMoney(r.annual)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {!d.rows.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No budget amounts or activity yet. {canEdit ? <Link className="text-primary underline" href="?tab=edit">Edit the budget</Link> : null}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Variance is favorable (▲) when income beats budget or expenses come in under it.</p>
        </>
      )}
    </>
  );
}
