import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { listLeases, occupiedUnitIds } from "@/server/leasing/queries";
import { LeasesTable } from "@/components/leasing/leases-table";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { filesFor, notesFor } from "@/server/records/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { EntityTasks } from "@/components/tasks/entity-tasks";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { UnitForm } from "@/components/rentals/unit-form";
import { formatMoney } from "@/lib/money";
import { formatBaths } from "@/lib/rentals";
import { PhotoGallery } from "@/components/images/photo-gallery";

const TABS = ["overview", "photos", "leases", "listing", "transactions", "tasks", "notes", "files"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ unitId: string }> }) {
  const ctx = await requireContext();
  const u = await ctx.db.unit.findFirst({ where: { id: (await params).unitId }, include: { property: { select: { name: true } } } });
  return { title: u ? `${u.property.name} · ${u.name}` : "Unit" };
}

export default async function UnitPage({ params, searchParams }: { params: Promise<{ unitId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { unitId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) notFound();
  const u = await ctx.db.unit.findFirst({ where: { id: unitId, property: { deletedAt: null } }, include: { property: true } });
  if (!u || !canAccessProperty(ctx.membership.propertyScope, u.propertyId)) notFound();
  const canEdit = can(ctx.permissions, "rentals", "edit");
  const base = `/app/rentals/units/${u.id}`;
  const [occupied, leases] = await Promise.all([occupiedUnitIds(ctx), listLeases(ctx, { units: { some: { unitId: u.id } } })]);
  const isOccupied = occupied.has(u.id);

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/rentals" className="hover:underline">Properties</Link> / <Link href={`/app/rentals/${u.propertyId}`} className="hover:underline">{u.property.name}</Link> / {u.name}</>}
        title={`${u.property.name} · ${u.name}`}
        image={u.photos[0] ? `/api/images/${u.photos[0]}` : u.property.photoUrl}
        status={<StatusBadge status={isOccupied ? "OCCUPIED" : "VACANT"} />}
        actions={!isOccupied && can(ctx.permissions, "leasing", "edit") ? <Button asChild><Link href={`/app/new/lease?unitId=${u.id}`} scroll={false}><Plus aria-hidden /> New lease</Link></Button> : null}
        subtitle={u.amenities.length ? u.amenities.join(" · ") : undefined}
        stats={[
          { label: "Beds / baths", value: `${u.beds ?? "—"} / ${formatBaths(u.bathsTenths)}` },
          { label: "Square feet", value: u.sqft?.toLocaleString("en-US") ?? "—" },
          { label: "Market rent", value: formatMoney(u.marketRentCents) },
          { label: "Listing", value: u.isListed ? <Badge tone="info">Listed</Badge> : <span className="text-muted-foreground">Not listed</span> },
        ]}
      />
      <EntityTabs
        base={base}
        active={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "photos", label: "Photos", count: u.photos.length },
          { id: "leases", label: "Leases", count: leases.length },
          { id: "listing", label: "Listing" },
          { id: "tasks", label: "Tasks" },
          { id: "notes", label: "Notes" },
          { id: "files", label: "Files" },
        ]}
      />
      {tab === "overview" ? (
        <Card className="max-w-3xl">
          <CardHeader><CardTitle>{canEdit ? "Edit unit" : "Details"}</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <UnitForm initial={{ id: u.id, propertyId: u.propertyId, name: u.name, beds: u.beds, bathsTenths: u.bathsTenths, sqft: u.sqft, marketRentCents: u.marketRentCents, amenities: u.amenities }} />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Name</dt><dd>{u.name}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Market rent</dt><dd>{formatMoney(u.marketRentCents)}</dd></div>
              </dl>
            )}
          </CardContent>
        </Card>
      ) : tab === "photos" ? (
        <PhotoGallery kind="unit" id={u.id} photos={u.photos} inherited={u.property.photos} canEdit={canEdit} />
      ) : tab === "notes" ? (
        <NotesPanel entityType="Unit" entityId={u.id} notes={await notesFor(ctx, "Unit", u.id)} canEdit={canEdit} />
      ) : tab === "files" ? (
        <FilesPanel entityType="Unit" entityId={u.id} files={await filesFor(ctx, "Unit", u.id)} canEdit={canEdit} />
      ) : tab === "listing" ? (
        <UnitListing ctx={ctx} unitId={u.id} canEdit={can(ctx.permissions, "leasing", "edit")} />
      ) : tab === "leases" || tab === "transactions" ? (
        <LeasesTable rows={leases} tab={`unit-${u.id}`} canEdit={can(ctx.permissions, "leasing", "edit")} />
      ) : (
        <EntityTasks ctx={ctx} where={{ unitId: u.id }} newHref={`/app/new/task?unitId=${u.id}`} tableId="unit-tasks" />
      )}
    </>
  );
}

async function UnitListing({ ctx, unitId, canEdit }: { ctx: Awaited<ReturnType<typeof requireContext>>; unitId: string; canEdit: boolean }) {
  const l = await ctx.db.listing.findFirst({ where: { unitId, status: { in: ["DRAFT", "PUBLISHED"] } }, orderBy: { createdAt: "desc" } });
  if (!l)
    return (
      <EmptyState
        icon={<Megaphone />}
        title="Not listed"
        description="Create a listing to advertise this unit on your public site and syndication feed. Its photos come from this unit (or the property)."
        action={canEdit ? <Button asChild><Link href={`/app/rentals/listings?new=${unitId}`}>Create listing</Link></Button> : undefined}
      />
    );
  return (
    <Card className="max-w-3xl">
      <CardHeader><CardTitle>{l.title}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p><Badge tone={l.status === "PUBLISHED" ? "success" : "neutral"}>{l.status === "PUBLISHED" ? "Published" : "Draft"}</Badge> · {formatMoney(l.rentCents)}/mo</p>
        <p className="line-clamp-3 text-muted-foreground">{l.description}</p>
        <p><Link href="/app/rentals/listings" className="font-medium text-primary underline">Manage listings</Link></p>
      </CardContent>
    </Card>
  );
}
