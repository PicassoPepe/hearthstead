import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt, MessagesSquare } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { filesFor, notesFor } from "@/server/records/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { EntityTasks } from "@/components/tasks/entity-tasks";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { OwnerForm } from "@/components/rentals/owner-form";
import { formatPercentBps, ownerDisplayName } from "@/lib/rentals";

const TABS = ["overview", "properties", "transactions", "tasks", "communications", "notes", "files"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ ownerId: string }> }) {
  const ctx = await requireContext();
  const o = await ctx.db.owner.findFirst({ where: { id: (await params).ownerId } });
  return { title: o ? ownerDisplayName(o) : "Owner" };
}

export default async function OwnerPage({ params, searchParams }: { params: Promise<{ ownerId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ownerId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) notFound();
  const o = await ctx.db.owner.findFirst({
    where: { id: ownerId },
    include: { ownerships: { where: { deletedAt: null, property: { deletedAt: null } }, include: { property: { include: { units: { where: { deletedAt: null }, select: { id: true } } } } }, orderBy: { percentBps: "desc" } } },
  });
  if (!o) notFound();
  const name = ownerDisplayName(o);
  const tax = (o.taxInfo ?? {}) as { taxIdType?: string | null; taxIdLast4?: string | null; send1099?: boolean };
  const canEdit = can(ctx.permissions, "people", "edit");
  const base = `/app/people/owners/${o.id}`;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/people/owners" className="hover:underline">Owners</Link> / {name}</>}
        title={name}
        status={<StatusBadge status={o.portalStatus} label={o.portalStatus === "NOT_INVITED" ? "Portal: not invited" : undefined} />}
        subtitle={[o.email, o.phone].filter(Boolean).join(" · ") || undefined}
        stats={[
          { label: "Properties", value: o.ownerships.length },
          { label: "Units", value: o.ownerships.reduce((s, x) => s + x.property.units.length, 0) },
          { label: "Tax ID", value: tax.taxIdLast4 ? `${tax.taxIdType ? `${tax.taxIdType} ` : ""}••${tax.taxIdLast4}` : "Not provided" },
          { label: "1099", value: tax.send1099 === false ? "No" : "Yes" },
        ]}
      />
      <EntityTabs
        base={base}
        active={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "properties", label: "Properties", count: o.ownerships.length },
          { id: "transactions", label: "Transactions" },
          { id: "tasks", label: "Tasks" },
          { id: "communications", label: "Communications" },
          { id: "notes", label: "Notes" },
          { id: "files", label: "Files" },
        ]}
      />
      {tab === "overview" ? (
        <Card className="max-w-3xl">
          <CardHeader><CardTitle>{canEdit ? "Edit owner" : "Contact"}</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <OwnerForm
                id={o.id}
                initial={{
                  kind: o.kind as "PERSON" | "COMPANY",
                  firstName: o.firstName ?? "", lastName: o.lastName ?? "", companyName: o.companyName ?? "",
                  email: o.email ?? "", phone: o.phone ?? "", addressLine1: o.addressLine1 ?? "", city: o.city ?? "",
                  state: o.state ?? "", postalCode: o.postalCode ?? "",
                  taxIdType: (tax.taxIdType ?? "") as "" | "SSN" | "EIN", taxIdLast4: tax.taxIdLast4 ?? "", send1099: tax.send1099 !== false,
                }}
                onDone={undefined}
              />
            ) : (
              <p className="text-sm">{[o.email, o.phone, o.addressLine1, o.city].filter(Boolean).join(" · ") || "No contact details"}</p>
            )}
          </CardContent>
        </Card>
      ) : tab === "properties" ? (
        o.ownerships.length ? (
          <div className="rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">Properties owned</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                <tr><th scope="col" className="px-4 py-2 font-medium">Property</th><th scope="col" className="px-4 py-2 font-medium">Share</th><th scope="col" className="px-4 py-2 font-medium">Units</th><th scope="col" className="px-4 py-2 font-medium">Agreement</th></tr>
              </thead>
              <tbody>
                {o.ownerships.map((x) => (
                  <tr key={x.id} className="border-t border-border">
                    <td className="px-4 py-2.5"><Link href={`/app/rentals/${x.propertyId}`} className="font-medium hover:underline">{x.property.name}</Link></td>
                    <td className="px-4 py-2.5 tabular">{formatPercentBps(x.percentBps)}</td>
                    <td className="px-4 py-2.5 tabular">{x.property.units.length}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{day(x.agreementStart) || "—"} → {day(x.agreementEnd) || "ongoing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No properties yet" description="Link this owner from a property's Owners tab or in the New Property wizard." />
        )
      ) : tab === "notes" ? (
        <NotesPanel entityType="Owner" entityId={o.id} notes={await notesFor(ctx, "Owner", o.id)} canEdit={canEdit} />
      ) : tab === "files" ? (
        <FilesPanel entityType="Owner" entityId={o.id} files={await filesFor(ctx, "Owner", o.id)} canEdit={canEdit} />
      ) : tab === "transactions" ? (
        <EmptyState icon={<Receipt />} title="Owner transactions arrive in Phase 6" description="Distributions, contributions and statements." />
      ) : tab === "tasks" ? (
        <EntityTasks ctx={ctx} where={{ OR: [{ ownerId: o.id }, { propertyId: { in: o.ownerships.map((x) => x.propertyId) }, type: "OWNER_REQUEST" }] }} newHref="/app/new/task" tableId="owner-tasks" />
      ) : (
        <EmptyState icon={<MessagesSquare />} title="Communications arrive in Phase 8" description="Every email, SMS and portal message with this owner." />
      )}
    </>
  );
}
