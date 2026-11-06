import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { listUnits, wizardOptions } from "@/server/rentals/queries";
import { filesFor, notesFor } from "@/server/records/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UnitsTable } from "@/components/rentals/tables";
import { PropertyEditButton } from "@/components/rentals/property-edit";
import { OwnershipEditor } from "@/components/rentals/ownership-editor";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { ScopedSettings } from "@/components/settings/scoped-settings";
import { formatMoney, sumCents } from "@/lib/money";
import { PROPERTY_TYPE_META, formatAddress, formatPercentBps, ownerDisplayName } from "@/lib/rentals";
import { ListChecks } from "lucide-react";
import { balancesBy, listLeases } from "@/server/leasing/queries";
import { LeasesTable } from "@/components/leasing/leases-table";
import { formatDate } from "@/lib/dates";

const TABS = ["overview", "units", "leases", "owners", "transactions", "tasks", "notes", "files", "settings"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ propertyId: string }> }) {
  const ctx = await requireContext();
  const p = await ctx.db.property.findFirst({ where: { id: (await params).propertyId }, select: { name: true } });
  return { title: p?.name ?? "Property" };
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { propertyId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view") || !canAccessProperty(ctx.membership.propertyScope, propertyId)) notFound();

  const p = await ctx.db.property.findFirst({
    where: { id: propertyId },
    include: {
      portfolio: true,
      defaultOperating: true,
      defaultDeposit: true,
      ownerships: { where: { deletedAt: null }, include: { owner: true }, orderBy: { percentBps: "desc" } },
    },
  });
  if (!p) notFound();
  const [units, noteCount, fileCount, leases, balances] = await Promise.all([
    listUnits(ctx, p.id),
    ctx.db.note.count({ where: { entityType: "Property", entityId: p.id } }),
    ctx.db.attachment.count({ where: { entityType: "Property", entityId: p.id } }),
    listLeases(ctx, { propertyId: p.id }),
    balancesBy(ctx, "propertyId", [p.id]),
  ]);
  const occupied = units.filter((u) => u.status === "OCCUPIED").length;
  const propBalance = balances.get(p.id) ?? 0;
  const canEdit = can(ctx.permissions, "rentals", "edit");
  const meta = PROPERTY_TYPE_META[p.type];
  const base = `/app/rentals/${p.id}`;
  const opts = canEdit ? await wizardOptions(ctx) : null;

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/rentals" className="hover:underline">Properties</Link> / {p.name}</>}
        title={p.name}
        status={<Badge tone="primary">{meta.label}</Badge>}
        subtitle={formatAddress(p)}
        stats={[
          { label: "Units", value: units.length },
          { label: "Occupancy", value: units.length ? `${Math.round((occupied / units.length) * 100)}% (${occupied}/${units.length})` : "—" },
          { label: "Market rent / mo", value: formatMoney(sumCents(units.map((u) => u.marketRentCents))) },
          { label: "Tenant balances", value: <span className={propBalance > 0 ? "text-danger" : ""}>{formatMoney(propBalance)}</span> },
        ]}
        actions={
          canEdit && opts ? (
            <>
              {!meta.singleUnit ? <Button asChild variant="secondary"><Link href={`/app/new/unit?propertyId=${p.id}`} scroll={false}><Plus aria-hidden /> Add unit</Link></Button> : null}
              <PropertyEditButton
                id={p.id}
                options={opts}
                initial={{
                  name: p.name,
                  portfolioId: p.portfolioId,
                  address: { addressLine1: p.addressLine1, addressLine2: p.addressLine2 ?? "", city: p.city, state: p.state as never, postalCode: p.postalCode },
                  yearBuilt: p.yearBuilt,
                  defaultOperatingAccountId: p.defaultOperatingAccountId,
                  defaultDepositAccountId: p.defaultDepositAccountId,
                  reserveCents: p.reserveCents,
                }}
              />
            </>
          ) : null
        }
      />
      <EntityTabs
        base={base}
        active={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "units", label: "Units", count: units.length },
          { id: "leases", label: "Leases", count: leases.filter((l) => l.status === "ACTIVE" || l.status === "EVICTION").length },
          { id: "owners", label: "Owners", count: p.ownerships.length },
          { id: "transactions", label: "Transactions" },
          { id: "tasks", label: "Tasks" },
          { id: "notes", label: "Notes", count: noteCount },
          { id: "files", label: "Files", count: fileCount },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Type", meta.label],
                  ["Portfolio", p.portfolio?.name ?? "None"],
                  ["Address", formatAddress(p)],
                  ["Year built", p.yearBuilt ?? "—"],
                  ["Operating account", p.defaultOperating ? `${p.defaultOperating.code} · ${p.defaultOperating.name}` : "Not set"],
                  ["Deposit account", p.defaultDeposit ? `${p.defaultDeposit.code} · ${p.defaultDeposit.name}` : "Not set"],
                  ["Reserve", formatMoney(p.reserveCents)],
                  ["Added", p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })],
                ].map(([k, v]) => (
                  <div key={String(k)}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5">{v}</dd></div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Owners</CardTitle></CardHeader>
            <CardContent>
              {p.ownerships.length ? (
                <ul className="space-y-2 text-sm">
                  {p.ownerships.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <Link href={`/app/people/owners/${o.ownerId}`} className="font-medium hover:underline">{ownerDisplayName(o.owner)}</Link>
                      <span className="tabular text-muted-foreground">{formatPercentBps(o.percentBps)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No owners linked. <Link href={`${base}?tab=owners`} className="font-medium text-primary underline">Link owners</Link></p>
              )}
            </CardContent>
          </Card>
          <div className="lg:col-span-3">
            <h2 className="mb-3 text-[15px] font-semibold">Units</h2>
            <UnitsTable rows={units} showProperty={false} canEdit={canEdit && !meta.singleUnit} canDelete={can(ctx.permissions, "rentals", "delete")} propertyId={p.id} />
          </div>
        </div>
      ) : tab === "units" ? (
        <UnitsTable rows={units} showProperty={false} canEdit={canEdit && !meta.singleUnit} canDelete={can(ctx.permissions, "rentals", "delete")} propertyId={p.id} />
      ) : tab === "owners" ? (
        <OwnershipEditor
          propertyId={p.id}
          canEdit={canEdit}
          owners={opts?.owners ?? []}
          initial={p.ownerships.map((o) => ({ ownerId: o.ownerId, percentBps: o.percentBps, agreementStart: day(o.agreementStart), agreementEnd: day(o.agreementEnd), ownerName: ownerDisplayName(o.owner) }))}
        />
      ) : tab === "notes" ? (
        <NotesPanel entityType="Property" entityId={p.id} notes={await notesFor(ctx, "Property", p.id)} canEdit={canEdit} />
      ) : tab === "files" ? (
        <FilesPanel entityType="Property" entityId={p.id} files={await filesFor(ctx, "Property", p.id)} canEdit={canEdit} />
      ) : tab === "settings" ? (
        <ScopedSettings ctx={ctx} scope="PROPERTY" scopeId={p.id} canEdit={canEdit} />
      ) : tab === "leases" ? (
        <LeasesTable rows={leases} tab={`property-${p.id}`} canEdit={can(ctx.permissions, "leasing", "edit")} />
      ) : tab === "transactions" ? (
        <PropertyTransactions ctx={ctx} propertyId={p.id} />
      ) : (
        <EmptyState icon={<ListChecks />} title="Tasks arrive in Phase 5" description="Work orders, tenant requests and inspections for this property will appear here." />
      )}
    </>
  );
}

async function PropertyTransactions({ ctx, propertyId }: { ctx: Awaited<ReturnType<typeof requireContext>>; propertyId: string }) {
  const txs = await ctx.db.leaseTransaction.findMany({
    where: { lease: { propertyId } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { lease: { include: { units: { include: { unit: { select: { name: true } } } } } } },
  });
  if (!txs.length) return <EmptyState title="No transactions yet" description="Charges and payments on this property's leases appear here." />;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">Recent transactions</caption>
        <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
          <tr>{["Date", "Unit", "Type", "Description", "Amount"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.id} className={`border-t border-border ${t.voidedAt ? "text-muted-foreground line-through" : ""}`}>
              <td className="px-3 py-2 tabular">{formatDate(t.date)}</td>
              <td className="px-3 py-2"><Link href={`/app/leasing/${t.leaseId}?tab=transactions`} className="hover:underline">{t.lease.units.map((u) => u.unit.name).join(", ")}</Link></td>
              <td className="px-3 py-2">{t.type.replace("_", " ").toLowerCase()}</td>
              <td className="px-3 py-2">{t.memo}</td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(t.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
