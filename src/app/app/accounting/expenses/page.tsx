import { CreditCard as CreditCardIcon } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { ExpensesTable } from "@/components/books/payables-views";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [expenses, accounts, props] = await Promise.all([
    ctx.db.expense.findMany({ orderBy: { date: "desc" }, take: 1000, include: { lines: true } }),
    ctx.db.account.findMany({ select: { id: true, name: true } }),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ]);
  const an = new Map(accounts.map((a) => [a.id, a.name]));
  const pn = new Map(props.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader icon={<CreditCardIcon aria-hidden />}
        eyebrow="Accounting"
        title="Expenses"
        description="Purchases paid straight from a bank account or card — no bill needed."
        actions={can(ctx.permissions, "accounting", "edit") ? <Button asChild><Link href="/app/new/expense" scroll={false}><Plus aria-hidden /> New expense</Link></Button> : null}
      />
      <ExpensesTable
        canDelete={can(ctx.permissions, "accounting", "delete")}
        rows={expenses.map((e) => ({
          id: e.id, date: toISODate(e.date), payee: e.payee, method: e.method, totalCents: e.totalCents, voided: !!e.voidedAt,
          accounts: [...new Set(e.lines.map((l) => an.get(l.accountId) ?? ""))].join(", "),
          properties: [...new Set(e.lines.map((l) => (l.propertyId ? pn.get(l.propertyId) ?? "" : "Company")))].join(", "),
        }))}
      />
    </>
  );
}
