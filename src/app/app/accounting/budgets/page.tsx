import Link from "next/link";
import { Target } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { NewBudgetButton } from "@/components/books/budget-editor";
import { orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="budgets" />;
  const scope = ctx.membership.propertyScope;
  const [budgets, properties, accounts, today] = await Promise.all([
    ctx.db.budget.findMany({ where: scope.length ? { propertyId: { in: scope } } : {}, orderBy: [{ year: "desc" }, { name: "asc" }] }),
    ctx.db.property.findMany({ where: scope.length ? { id: { in: scope } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } }),
    orgToday(ctx),
  ]);
  const type = new Map(accounts.map((a) => [a.id, a.type]));
  const totals = (amounts: unknown) => {
    let inc = 0;
    let exp = 0;
    for (const [k, v] of Object.entries((amounts ?? {}) as Record<string, number[]>)) {
      const s = v.reduce((n, x) => n + x, 0);
      if (type.get(k) === "INCOME") inc += s; else exp += s;
    }
    return { inc, exp };
  };
  return (
    <>
      <PageHeader icon={<Target aria-hidden />} eyebrow="Rent & Money" title="Budgets" description="Plan how much money you expect to come in and go out each month. Fill a budget in from your leases, repeating bills or last year, then see how you’re doing against it."
        actions={can(ctx.permissions, "accounting", "edit") ? <NewBudgetButton properties={properties} defaultYear={today.getUTCFullYear()} canCompany={!scope.length} /> : undefined} />
      {budgets.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No budgets yet. Start one from last year&apos;s actuals — adjust by a percentage, then fine-tune by month.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {budgets.map((b) => {
            const t = totals(b.amounts);
            return (
              <li key={b.id}>
                <Link href={`/app/accounting/budgets/${b.id}`} className="card-hover block rounded-card border border-border bg-surface p-4 shadow-card">
                  <p className="text-xs text-muted-foreground">{b.year} · {b.propertyId ? properties.find((p) => p.id === b.propertyId)?.name : "Company-wide"}</p>
                  <h2 className="mt-0.5 font-semibold">{b.name}</h2>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Income</dt><dd className="tabular font-medium">{formatMoney(t.inc, { showCents: false })}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Expenses</dt><dd className="tabular font-medium">{formatMoney(t.exp, { showCents: false })}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Net</dt><dd className="tabular font-medium">{formatMoney(t.inc - t.exp, { showCents: false })}</dd></div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
