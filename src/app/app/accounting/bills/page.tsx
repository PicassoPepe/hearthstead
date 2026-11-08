import { Receipt as ReceiptIcon } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { BillsTable } from "@/components/books/payables-views";
import { listBills } from "@/server/accounting/queries";
import { bankAccounts } from "@/server/accounting/payables";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Bills" };

export default async function BillsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [rows, banks, recurring] = await Promise.all([listBills(ctx), bankAccounts(ctx.db), ctx.db.recurringBill.count({ where: { active: true } })]);
  const open = rows.filter((r) => r.openCents > 0);
  const in7 = toISODate(new Date(Date.now() + 7 * 86_400_000));
  const canEdit = can(ctx.permissions, "accounting", "edit");
  return (
    <>
      <PageHeader icon={<ReceiptIcon aria-hidden />}
        eyebrow="Accounting"
        title="Bills"
        description="What you owe vendors. Select bills to pay them in one go — each payment posts to the ledger."
        actions={canEdit ? <Button asChild><Link href="/app/new/bill" scroll={false}><Plus aria-hidden /> New bill</Link></Button> : null}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open payables" value={formatMoney(open.reduce((s, r) => s + r.openCents, 0))} hint={`${open.length} bills`} />
        <StatCard label="Overdue" value={formatMoney(open.filter((r) => r.overdue).reduce((s, r) => s + r.openCents, 0))} hint={`${open.filter((r) => r.overdue).length} bills`} />
        <StatCard label="Due in 7 days" value={formatMoney(open.filter((r) => !r.overdue && r.dueDate <= in7).reduce((s, r) => s + r.openCents, 0))} />
        <StatCard label="Recurring bills" value={recurring} hint="Created nightly" />
      </div>
      <BillsTable rows={rows} banks={banks.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}`, purpose: b.purpose }))} canEdit={canEdit} today={toISODate(new Date())} />
    </>
  );
}
