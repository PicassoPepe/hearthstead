import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BillActions } from "@/components/books/payables-views";
import { billDetail } from "@/server/accounting/queries";
import { bankAccounts } from "@/server/accounting/payables";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Bill" };

export default async function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const d = await billDetail(ctx, billId);
  if (!d) notFound();
  const banks = await bankAccounts(ctx.db);
  const { bill } = d;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/accounting/bills" className="hover:underline">← Bills</Link>}
        title={`${bill.vendor.name}${bill.billNumber ? ` · #${bill.billNumber}` : ""}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={bill.status} /> Billed {formatDate(bill.billDate)} · due {formatDate(bill.dueDate)} · {formatMoney(d.openCents)} open of {formatMoney(bill.totalCents)}</span>}
        actions={
          <BillActions
            bill={{ id: bill.id, vendor: bill.vendor.name, number: bill.billNumber ? `#${bill.billNumber}` : "", openCents: d.openCents, status: bill.status }}
            banks={banks.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}`, purpose: b.purpose }))}
            today={toISODate(new Date())}
            canEdit={can(ctx.permissions, "accounting", "edit")}
            canDelete={can(ctx.permissions, "accounting", "delete")}
            payments={d.payments}
            openCredits={d.openCredits}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">Bill lines</caption>
              <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Account</th><th scope="col" className="py-1.5">Description</th><th scope="col" className="py-1.5">Property</th><th scope="col" className="py-1.5 text-right">Amount</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border"><td className="py-2">{l.account}</td><td className="py-2">{l.description ?? "—"}</td><td className="py-2">{l.property ?? "Company"}</td><td className="py-2 text-right tabular">{formatMoney(l.amountCents)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border font-medium"><td className="py-2" colSpan={3}>Total</td><td className="py-2 text-right tabular">{formatMoney(bill.totalCents)}</td></tr></tfoot>
            </table>
            {bill.memo ? <p className="mt-3 text-sm text-muted-foreground">{bill.memo}</p> : null}
            {d.task ? <p className="mt-3 text-sm">From work order <Link className="text-primary hover:underline" href={`/app/tasks/${d.task.id}`}>#{d.task.number} {d.task.title}</Link></p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payments &amp; credits</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className={`flex justify-between gap-2 ${p.voided ? "text-muted-foreground line-through" : ""}`}>
                  <span>{formatDate(p.date)} · {p.method.toLowerCase()}{p.reference ? ` #${p.reference}` : ""} from {p.bank}</span>
                  <span className="tabular">{formatMoney(p.amountCents)}</span>
                </li>
              ))}
              {d.credits.map((c) => (
                <li key={c.id} className="flex justify-between gap-2"><span>{formatDate(c.date)} · vendor credit{c.memo ? ` (${c.memo})` : ""}</span><span className="tabular">{formatMoney(c.amountCents)}</span></li>
              ))}
              {!d.payments.length && !d.credits.length ? <li className="text-muted-foreground">No payments yet.</li> : null}
              <li className="mt-2 flex justify-between border-t border-border pt-2 font-medium"><span>Open balance</span><span className="tabular">{formatMoney(d.openCents)}</span></li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
