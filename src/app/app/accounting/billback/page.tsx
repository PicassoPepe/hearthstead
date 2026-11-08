import { Droplets } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { BillbackTool } from "@/components/books/billback-tool";
import { orgToday } from "@/server/leasing/queries";
import { addMonths, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Utility billback" };

export default async function BillbackPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="utility billback" />;
  const scope = ctx.membership.propertyScope;
  const [properties, accounts, history, today] = await Promise.all([
    ctx.db.property.findMany({ where: { ...(scope.length ? { id: { in: scope } } : {}), type: { notIn: ["SINGLE_FAMILY"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.account.findMany({ where: { type: { in: ["EXPENSE", "INCOME"] }, deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, type: true, systemKey: true } }),
    ctx.db.utilityBillback.findMany({ where: scope.length ? { propertyId: { in: scope } } : {}, orderBy: { createdAt: "desc" }, take: 50 }),
    orgToday(ctx),
  ]);
  const pname = new Map(properties.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader icon={<Droplets aria-hidden />} eyebrow="Accounting" title="Utility billback" description="Split a property's water, sewer, trash or gas bill across its occupied units (RUBS) and post the charges to each lease." />
      {can(ctx.permissions, "accounting", "edit") ? (
        <BillbackTool
          properties={properties}
          expenseAccounts={accounts.filter((a) => a.type === "EXPENSE").map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          incomeAccounts={accounts.filter((a) => a.type === "INCOME").map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          defaultExpense={accounts.find((a) => a.systemKey === "UTILITIES")?.id ?? ""}
          defaultIncome={accounts.find((a) => a.code === "4600")?.id ?? ""}
          defaultPeriod={toISODate(addMonths(today, -1)).slice(0, 7)}
        />
      ) : null}
      <section aria-labelledby="hist-h" className="mt-6">
        <h2 id="hist-h" className="mb-2 text-[15px] font-semibold">Past billbacks</h2>
        {history.length ? (
          <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Past billbacks</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Month", "Property", "Utility", "Bill", "Recovered", "Leases"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular">{h.period}</td>
                    <td className="px-3 py-2">{pname.get(h.propertyId) ?? "—"}</td>
                    <td className="px-3 py-2">{h.label}</td>
                    <td className="px-3 py-2 tabular">{formatMoney(h.billCents)}</td>
                    <td className="px-3 py-2 tabular">{formatMoney(h.totalCents)} ({h.recoveryPct}%)</td>
                    <td className="px-3 py-2 tabular">{(h.lines as unknown[]).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">None yet.</p>}
      </section>
    </>
  );
}
