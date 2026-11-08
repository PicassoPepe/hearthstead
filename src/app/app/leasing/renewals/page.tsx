import { RefreshCw as RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { RenewalOfferButton, RenewalStatusButtons } from "@/components/funnel/funnel-forms";
import { renewalCandidates } from "@/server/funnel/renewals";
import { orgToday } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { diffDays, formatDate, parseISODate } from "@/lib/dates";

export const metadata = { title: "Renewals" };

export default async function RenewalsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="renewals" />;
  const today = await orgToday(ctx);
  const rows = await renewalCandidates(ctx.db, today, 120);
  const canEdit = can(ctx.permissions, "leasing", "edit");
  return (
    <>
      <PageHeader icon={<RefreshCwIcon aria-hidden />} eyebrow="Leasing" title="Renewals" description="Leases ending in the next 120 days. Offers go out as an e-sign addendum; once everyone signs, the renewal lease is created." />
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Upcoming renewals</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Lease", "Tenants", "Ends", "Rent", "Market", "Suggested", "Offer", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.leaseId} className="border-t border-border">
                <td className="px-3 py-2"><Link href={`/app/leasing/${r.leaseId}`} className="font-medium text-primary hover:underline">{r.label}</Link></td>
                <td className="px-3 py-2">{r.tenants}</td>
                <td className="px-3 py-2">{formatDate(r.endDate)}<div className="text-xs text-muted-foreground">in {diffDays(today, parseISODate(r.endDate))} days</div></td>
                <td className="px-3 py-2 tabular">{formatMoney(r.rentCents)}</td>
                <td className="px-3 py-2 tabular">{formatMoney(r.marketCents)}</td>
                <td className="px-3 py-2 tabular">{formatMoney(r.suggestedCents)}</td>
                <td className="px-3 py-2">{r.offer ? <><StatusBadge status={r.offer.status} /><div className="text-xs text-muted-foreground">{formatMoney(r.offer.newRentCents)} · {r.offer.termMonths} mo</div></> : "—"}</td>
                <td className="px-3 py-2 text-right">{canEdit ? (r.offer?.status === "SENT" ? <RenewalStatusButtons offerId={r.offer.id} /> : r.offer?.status === "ACCEPTED" ? null : <RenewalOfferButton leaseId={r.leaseId} label={r.label} rentCents={r.rentCents} suggestedCents={r.suggestedCents} />) : null}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No leases end in the next 120 days.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
