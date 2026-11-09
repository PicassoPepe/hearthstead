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
import { InvoiceReview } from "@/components/books/invoice-review";
import { listBills } from "@/server/accounting/queries";
import { bankAccounts } from "@/server/accounting/payables";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Bills" };

export default async function BillsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const scope = ctx.membership.propertyScope;
  const [rows, banks, recurring, invoices, approvals, accounts, properties] = await Promise.all([
    listBills(ctx), bankAccounts(ctx.db), ctx.db.recurringBill.count({ where: { active: true } }),
    ctx.db.vendorInvoice.findMany({ where: { status: "SUBMITTED", ...(scope.length ? { OR: [{ propertyId: { in: scope } }, { propertyId: null }] } : {}) }, orderBy: { createdAt: "asc" } }),
    ctx.db.ownerApproval.findMany({ where: { status: { in: ["PENDING", "DECLINED"] }, ...(scope.length ? { propertyId: { in: scope } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    ctx.db.account.findMany({ where: { type: { in: ["EXPENSE", "ASSET"] }, isBank: false, deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, systemKey: true, type: true } }),
    ctx.db.property.findMany({ where: scope.length ? { id: { in: scope } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const vendors = new Map((await ctx.db.vendor.findMany({ where: { id: { in: invoices.map((i) => i.vendorId) } } })).map((v) => [v.id, v]));
  const invTasks = new Map((await ctx.db.task.findMany({ where: { id: { in: invoices.map((i) => i.taskId).filter((x): x is string => Boolean(x)) } }, select: { id: true, number: true, title: true } })).map((t) => [t.id, `#${t.number} ${t.title}`]));
  const repairs = accounts.find((a) => a.systemKey === "REPAIRS")?.id ?? accounts.find((a) => a.type === "EXPENSE")?.id ?? "";
  const pname = new Map(properties.map((p) => [p.id, p.name]));
  const open = rows.filter((r) => r.openCents > 0);
  const in7 = toISODate(new Date(Date.now() + 7 * 86_400_000));
  const canEdit = can(ctx.permissions, "accounting", "edit");
  return (
    <>
      <PageHeader icon={<ReceiptIcon aria-hidden />}
        eyebrow="Rent & Money"
        title="Bills to pay"
        description="Bills you owe — from repair companies, utilities and others. Tick the ones you want to pay, then press Pay. Add a new one with “New bill”."
        actions={canEdit ? <Button asChild><Link href="/app/new/bill" scroll={false}><Plus aria-hidden /> New bill</Link></Button> : null}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open payables" value={formatMoney(open.reduce((s, r) => s + r.openCents, 0))} hint={`${open.length} bills`} />
        <StatCard label="Overdue" value={formatMoney(open.filter((r) => r.overdue).reduce((s, r) => s + r.openCents, 0))} hint={`${open.filter((r) => r.overdue).length} bills`} />
        <StatCard label="Due in 7 days" value={formatMoney(open.filter((r) => !r.overdue && r.dueDate <= in7).reduce((s, r) => s + r.openCents, 0))} />
        <StatCard label="Recurring bills" value={recurring} hint="Created nightly" />
      </div>
      {canEdit ? (
        <InvoiceReview
          defaultDue={toISODate(new Date(Date.now() + 14 * 86_400_000))}
          accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
          properties={properties}
          rows={invoices.map((i) => ({ id: i.id, vendor: vendors.get(i.vendorId)?.name ?? "Vendor", invoiceNumber: i.invoiceNumber, invoiceDate: toISODate(i.invoiceDate), amountCents: i.amountCents, description: i.description, workOrder: i.taskId ? invTasks.get(i.taskId) ?? null : null, propertyId: i.propertyId, attachmentId: i.attachmentId, defaultAccountId: vendors.get(i.vendorId)?.defaultExpenseAccountId ?? repairs }))}
        />
      ) : null}
      {approvals.length ? (
        <section aria-labelledby="appr-h" className="mb-4 rounded-card border border-warning/40 bg-warning-soft/40 p-4">
          <h2 id="appr-h" className="mb-2 font-semibold">Owner approvals</h2>
          <ul className="grid gap-1 text-sm" data-testid="owner-approvals">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2">
                <Link className="font-medium text-primary hover:underline" href={`/app/accounting/bills/${a.entityId}`}>{a.title}</Link>
                <span className="tabular">{formatMoney(a.amountCents)} · {pname.get(a.propertyId)} · {a.status === "PENDING" ? "waiting for owner" : <span className="font-semibold text-danger">declined{a.note ? ` — “${a.note}”` : ""}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <BillsTable rows={rows} banks={banks.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}`, purpose: b.purpose }))} canEdit={canEdit} today={toISODate(new Date())} />
    </>
  );
}
