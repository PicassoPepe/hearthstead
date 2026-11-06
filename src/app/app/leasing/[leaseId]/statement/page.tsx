import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { ledger } from "@/server/leasing/queries";
import * as M from "@/server/leasing/money";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { TX_LABEL, tenantDisplayName } from "@/lib/leasing";
import { PrintButton } from "@/components/leasing/print-button";

export const metadata = { title: "Statement" };

/** Printable tenant statement (use the browser's "Save as PDF"). */
export default async function StatementPage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params;
  const ctx = await requireContext();
  const lease = await ctx.db.lease.findFirst({
    where: { id: leaseId },
    include: { property: true, units: { include: { unit: true } }, tenants: { include: { tenant: true }, orderBy: { role: "asc" } } },
  });
  if (!lease || !can(ctx.permissions, "leasing", "view") || !canAccessProperty(ctx.membership.propertyScope, lease.propertyId)) notFound();
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const [rows, bal] = await Promise.all([ledger(ctx, lease.id), ctx.db.tx((tx) => M.leaseBalance(tx, lease.id))]);
  const chronological = [...rows].reverse().filter((r) => !r.voided && r.effectCents !== 0);

  return (
    <div className="mx-auto max-w-3xl bg-surface p-8 text-sm print:max-w-none print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/app/leasing/${lease.id}?tab=transactions`} className="text-primary hover:underline">← Back to lease</Link>
        <PrintButton />
      </div>
      <header className="flex justify-between gap-6 border-b border-border pb-4">
        <div>
          <div className="text-lg font-semibold" style={{ color: org.brandColor }}>{org.name}</div>
          <div className="text-muted-foreground">{[org.addressLine1, org.city, org.state, org.postalCode].filter(Boolean).join(", ")}</div>
          <div className="text-muted-foreground">{[org.phone, org.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-semibold">Statement</h1>
          <div className="text-muted-foreground">{formatDate(new Date())}</div>
        </div>
      </header>
      <section className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-muted-foreground">Tenant</div>
          {lease.tenants.map((t) => <div key={t.id}>{tenantDisplayName(t.tenant)}</div>)}
          <div>{lease.property.addressLine1}{lease.units[0] && lease.units[0].unit.name !== "Main" ? `, Unit ${lease.units.map((u) => u.unit.name).join(", ")}` : ""}</div>
          <div>{lease.property.city}, {lease.property.state} {lease.property.postalCode}</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-right">
          <div className="text-xs uppercase text-muted-foreground">{bal.balanceCents < 0 ? "Credit balance" : "Amount due"}</div>
          <div className="text-2xl font-semibold tabular">{formatMoney(Math.abs(bal.balanceCents))}</div>
        </div>
      </section>
      <table className="mt-6 w-full">
        <caption className="sr-only">Transactions</caption>
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr><th scope="col" className="py-2">Date</th><th scope="col" className="py-2">Description</th><th scope="col" className="py-2 text-right">Charges</th><th scope="col" className="py-2 text-right">Payments</th><th scope="col" className="py-2 text-right">Balance</th></tr>
        </thead>
        <tbody>
          {chronological.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="py-1.5 tabular">{formatDate(r.date)}</td>
              <td className="py-1.5">{r.memo || TX_LABEL[r.type]}</td>
              <td className="py-1.5 text-right tabular">{r.effectCents > 0 ? formatMoney(r.amountCents) : ""}</td>
              <td className="py-1.5 text-right tabular">{r.effectCents < 0 ? formatMoney(r.amountCents) : ""}</td>
              <td className="py-1.5 text-right tabular">{formatMoney(r.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {chronological.length === 0 ? <p className="mt-4 text-muted-foreground">No transactions.</p> : null}
    </div>
  );
}
