import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { ProspectStatusSelect } from "@/components/funnel/funnel-forms";
import { PROSPECT_STATUSES, PROSPECT_STATUS_LABEL } from "@/lib/funnel";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Prospects" };

export default async function ProspectsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="prospects" />;
  const [prospects, listings] = await Promise.all([
    ctx.db.prospect.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 500 }),
    ctx.db.listing.findMany({ select: { id: true, title: true } }),
  ]);
  const canEdit = can(ctx.permissions, "leasing", "edit");
  return (
    <>
      <PageHeader eyebrow="People" title="Prospects" description="Leads from your listings, walk-ins and referrals — from first contact to signed lease."
        actions={canEdit ? <Button asChild><Link href="/app/new/prospect" scroll={false}><Plus aria-hidden /> New prospect</Link></Button> : null} />
      <dl className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {PROSPECT_STATUSES.map((s) => <div key={s} className="rounded-card border border-border bg-surface p-3 text-center shadow-card"><dt className="text-xs text-muted-foreground">{PROSPECT_STATUS_LABEL[s]}</dt><dd className="text-xl font-semibold tabular">{prospects.filter((p) => p.status === s).length}</dd></div>)}
      </dl>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Prospects</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Name", "Contact", "Interested in", "Source", "Added", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {prospects.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{p.firstName} {p.lastName}</td>
                <td className="px-3 py-2">{[p.email, p.phone].filter(Boolean).join(" · ")}</td>
                <td className="px-3 py-2">{listings.find((l) => l.id === p.listingId)?.title ?? "—"}</td>
                <td className="px-3 py-2">{p.source.replace("_", " ").toLowerCase()}</td>
                <td className="px-3 py-2">{formatDate(p.createdAt)}</td>
                <td className="px-3 py-2">{canEdit ? <ProspectStatusSelect id={p.id} status={p.status} name={`${p.firstName} ${p.lastName}`} /> : <StatusBadge status={p.status} />}</td>
              </tr>
            ))}
            {!prospects.length ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No prospects yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
