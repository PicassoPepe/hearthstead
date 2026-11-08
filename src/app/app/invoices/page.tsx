import { Receipt } from "lucide-react";
import { requireContext } from "@/server/context";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Badge } from "@/components/ui/badge";
import { VendorInvoiceForm } from "@/components/books/vendor-invoice-form";
import { WelcomeSteps } from "@/components/onboarding/welcome-steps";
import { vendorForUser } from "@/server/accounting/vendor-invoices";
import { billOpenCents } from "@/server/accounting/payables";
import { orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Invoices" };

/** Vendor portal: submit invoices for work orders and track approval and payment. */
export default async function VendorInvoicesPage() {
  const ctx = await requireContext();
  const vendor = await vendorForUser(ctx.db, ctx.user.id);
  if (!vendor) return <Forbidden what="vendor invoices" />;
  const [invoices, tasks, today] = await Promise.all([
    ctx.db.vendorInvoice.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.task.findMany({ where: { vendorId: vendor.id, billId: null, status: { not: "ARCHIVED" } }, orderBy: { number: "desc" }, select: { id: true, number: true, title: true, status: true } }),
    orgToday(ctx),
  ]);
  const invoiced = new Set(invoices.filter((i) => i.status !== "REJECTED" && i.taskId).map((i) => i.taskId));
  const paid = new Map<string, number>();
  for (const i of invoices) if (i.billId) paid.set(i.id, await billOpenCents(ctx.db, i.billId));
  const status = (i: (typeof invoices)[number]) => i.status === "REJECTED" ? <Badge tone="danger">Returned</Badge> : i.status === "SUBMITTED" ? <Badge tone="info">In review</Badge> : (paid.get(i.id) ?? 1) <= 0 ? <Badge tone="success">Paid</Badge> : <Badge tone="primary">Approved · awaiting payment</Badge>;
  return (
    <>
      <PageHeader icon={<Receipt aria-hidden />} title="Invoices" description={`Submit invoices to ${ctx.org.name} and see when they're approved and paid.`} />
      <div className="mb-4">
        <WelcomeSteps storageKey={`dw-welcome-vendor-${vendor.id}`} title={`Welcome, ${vendor.name}`} intro={`Here's how working with ${ctx.org.name} goes.`} steps={[
          { id: "orders", label: "Check your work orders", description: "Accept jobs and update status as you go.", href: "/app/tasks", done: tasks.length > 0 || invoices.length > 0 },
          { id: "invoice", label: "Submit an invoice", description: "Attach your PDF; link it to the work order.", href: "#new-invoice", done: invoices.length > 0 },
          { id: "paid", label: "Get paid", description: "Track approval and payment here.", href: "#history", done: [...paid.values()].some((v) => v <= 0) },
        ]} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <section id="new-invoice" aria-labelledby="ni-h" className="rounded-card border border-border bg-surface p-5 shadow-card">
          <h2 id="ni-h" className="mb-3 text-lg font-semibold">New invoice</h2>
          <VendorInvoiceForm today={toISODate(today)} workOrders={tasks.filter((t) => !invoiced.has(t.id)).map((t) => ({ id: t.id, label: `#${t.number} · ${t.title}` }))} />
        </section>
        <section id="history" aria-labelledby="hist-h">
          <h2 id="hist-h" className="mb-2 text-lg font-semibold">Your invoices</h2>
          {invoices.length ? (
            <ul className="grid gap-2" data-testid="vendor-invoices">
              {invoices.map((i) => (
                <li key={i.id} className="rounded-card border border-border bg-surface p-4 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">#{i.invoiceNumber} · <span className="tabular">{formatMoney(i.amountCents)}</span></span>
                    {status(i)}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatDate(i.invoiceDate)} · {i.description}</p>
                  {i.reviewNote ? <p className="mt-1 text-sm text-danger">Note from {ctx.org.name}: {i.reviewNote}</p> : null}
                </li>
              ))}
            </ul>
          ) : <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No invoices yet.</p>}
        </section>
      </div>
    </>
  );
}
