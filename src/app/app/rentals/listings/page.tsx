import Link from "next/link";
import { ExternalLink, Plus, Rss } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { ListingEditor, ListingStatusButton } from "@/components/funnel/listing-editor";
import { occupiedUnitIds } from "@/server/leasing/queries";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";

export const metadata = { title: "Listings" };

export default async function ListingsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) return <Forbidden what="listings" />;
  const [listings, units, occ, org, leads] = await Promise.all([
    ctx.db.listing.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    ctx.db.unit.findMany({ where: { deletedAt: null, property: { deletedAt: null } }, orderBy: [{ property: { name: "asc" } }, { name: "asc" }], include: { property: { select: { name: true } } } }),
    occupiedUnitIds(ctx),
    ctx.db.organization.findFirstOrThrow({ where: { id: ctx.org.id } }),
    ctx.db.prospect.groupBy({ by: ["listingId"], _count: true }),
  ]);
  const unitLabel = new Map(units.map((u) => [u.id, `${u.property.name} · ${u.name}`]));
  const listed = new Set(listings.filter((l) => l.status !== "UNLISTED").map((l) => l.unitId));
  const vacant = units.filter((u) => !occ.has(u.id) && !listed.has(u.id)).map((u) => ({ id: u.id, label: `${u.property.name} · ${u.name}`, marketRentCents: u.marketRentCents }));
  const canEdit = can(ctx.permissions, "rentals", "edit");
  return (
    <>
      <PageHeader
        eyebrow="Rentals"
        title="Listings"
        description={`${listings.filter((l) => l.status === "PUBLISHED").length} published · ${vacant.length} vacant units not listed yet`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary"><a href={`/l/${org.slug}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Public page</a></Button>
            <Button asChild variant="secondary"><a href={`/api/listings/feed/${org.slug}`} target="_blank" rel="noreferrer"><Rss aria-hidden /> Feed</a></Button>
            {canEdit ? <ListingEditor units={vacant} trigger={<Button><Plus aria-hidden /> New listing</Button>} /> : null}
          </div>
        }
      />
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Listings</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Listing", "Unit", "Rent", "Available", "Leads", "Status", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="px-3 py-2"><div className="font-medium">{l.title}</div>{l.status === "PUBLISHED" ? <a className="text-xs text-primary hover:underline" href={`/l/${org.slug}/${l.slug}`} target="_blank" rel="noreferrer">/l/{org.slug}/{l.slug}</a> : l.unlistedReason ? <span className="text-xs text-muted-foreground">{l.unlistedReason}</span> : null}</td>
                <td className="px-3 py-2">{unitLabel.get(l.unitId)}</td>
                <td className="px-3 py-2 tabular">{formatMoney(l.rentCents)}</td>
                <td className="px-3 py-2">{l.availableOn ? formatDate(l.availableOn) : "Now"}</td>
                <td className="px-3 py-2 tabular">{leads.find((x) => x.listingId === l.id)?._count ?? 0}</td>
                <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canEdit ? (
                    <>
                      <ListingEditor units={[{ id: l.unitId, label: unitLabel.get(l.unitId) ?? "", marketRentCents: l.rentCents }]} initial={{ id: l.id, unitId: l.unitId, title: l.title, description: l.description, rentCents: l.rentCents, depositCents: l.depositCents, availableOn: l.availableOn ? toISODate(l.availableOn) : "", leaseTermMonths: l.leaseTermMonths, petPolicy: l.petPolicy, syndicate: l.syndicate }} trigger={<Button size="sm" variant="ghost" aria-label={`Edit ${l.title}`}>Edit</Button>} />
                      <ListingStatusButton id={l.id} status={l.status} />
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {!listings.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No listings yet. {vacant.length ? `You have ${vacant.length} vacant units ready to list.` : ""}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Prospects and showings: <Link className="text-primary hover:underline" href="/app/leasing/showings">Showings</Link> · <Link className="text-primary hover:underline" href="/app/people/prospects">Prospects</Link> · <Link className="text-primary hover:underline" href="/app/leasing/applications">Applications</Link></p>
    </>
  );
}
