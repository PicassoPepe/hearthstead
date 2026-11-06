"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Building2, DoorOpen, Plus, Upload, UserRound } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { PROPERTY_TYPE_META, PROPERTY_TYPES, formatBaths, type PropertyTypeKey } from "@/lib/rentals";
import { setOwnerArchived, setPropertyArchived, setUnitArchived } from "@/server/actions/rentals";
import type { PropertyRow, UnitRow } from "@/server/rentals/queries";

/** Archive with confirm + undo, shared by the tables below. */
function useArchive(kind: "property" | "unit" | "owner") {
  const router = useRouter();
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);
  const fn = kind === "property" ? setPropertyArchived : kind === "unit" ? setUnitArchived : setOwnerArchived;
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && setTarget(null)}
      title={`Archive ${target?.name ?? kind}?`}
      description={`It will be hidden from lists and reports. Nothing is permanently deleted, and you can undo this.`}
      confirmLabel="Archive"
      destructive
      onConfirm={async () => {
        const t = target!;
        setTarget(null);
        const r = await fn(t.id, true);
        if (!r.ok) return void toast.error(r.error);
        router.refresh();
        toast.success(`${t.name} archived`, {
          action: {
            label: "Undo",
            onClick: async () => {
              const u = await fn(t.id, false);
              if (u.ok) { toast.success(`${t.name} restored`); router.refresh(); } else toast.error(u.error);
            },
          },
        });
      }}
    />
  );
  return { ask: (id: string, name: string) => setTarget({ id, name }), dialog };
}

export function PropertiesTable({ rows, portfolios, canEdit, canDelete }: { rows: PropertyRow[]; portfolios: { id: string; name: string }[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const archive = useArchive("property");
  const columns = React.useMemo<ColumnDef<PropertyRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Property",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link href={`/app/rentals/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.name}
            </Link>
            <div className="truncate text-xs text-muted-foreground">{row.original.address}</div>
          </div>
        ),
      },
      { accessorKey: "type", header: "Type", filterFn: "equals", cell: ({ row }) => PROPERTY_TYPE_META[row.original.type as PropertyTypeKey].label },
      { accessorKey: "portfolio", header: "Portfolio", filterFn: "equals", cell: ({ row }) => row.original.portfolio || <span className="text-muted-foreground">—</span> },
      { accessorKey: "units", header: "Units", cell: ({ row }) => <span className="tabular">{row.original.units}</span> },
      {
        id: "occupancy",
        header: "Occupancy",
        accessorFn: (r) => (r.units ? Math.round((r.occupied / r.units) * 100) : 0),
        cell: ({ row }) => <span className="tabular text-muted-foreground" title="Occupancy is calculated from leases (Phase 3)">{row.original.units && row.original.occupied ? `${Math.round((row.original.occupied / row.original.units) * 100)}%` : "—"}</span>,
      },
      { accessorKey: "owners", header: "Owners", cell: ({ row }) => row.original.owners || <Badge tone="warning">No owner</Badge> },
      { accessorKey: "marketRentCents", header: "Market rent", cell: ({ row }) => <span className="tabular">{formatMoney(row.original.marketRentCents)}</span> },
      { id: "balance", header: "Balance", accessorFn: () => 0, enableSorting: false, cell: () => <span className="tabular text-muted-foreground">—</span> },
      { accessorKey: "address", header: "Address" },
    ],
    [],
  );
  return (
    <>
      <DataTable
        tableId="properties"
        label="Properties"
        data={rows}
        columns={columns}
        hiddenColumns={["address"]}
        getRowId={(r) => r.id}
        searchPlaceholder="Search name, address, owner"
        onRowClick={(r) => router.push(`/app/rentals/${r.id}`)}
        filters={[
          { columnId: "type", label: "Types", options: PROPERTY_TYPES.filter((t) => rows.some((r) => r.type === t)).map((t) => ({ value: t, label: PROPERTY_TYPE_META[t].label })) },
          ...(portfolios.length ? [{ columnId: "portfolio", label: "Portfolios", options: portfolios.map((p) => ({ value: p.name, label: p.name })) }] : []),
        ]}
        rowActions={(r) => [
          { label: "Open", onSelect: () => router.push(`/app/rentals/${r.id}`) },
          ...(canEdit ? [{ label: "Edit details", onSelect: () => router.push(`/app/rentals/${r.id}?tab=overview&edit=1`) }] : []),
          ...(canDelete ? [{ label: "Archive", destructive: true, onSelect: () => archive.ask(r.id, r.name) }] : []),
        ]}
        empty={
          <EmptyState
            icon={<Building2 />}
            title="Add your first property"
            description="Properties hold your units, owners and bank accounts. Add one with the guided wizard, or import many from a spreadsheet."
            action={canEdit ? <Button asChild><Link href="/app/new/property" scroll={false}><Plus aria-hidden /> Add property</Link></Button> : undefined}
            secondary={canEdit ? <Button asChild variant="secondary"><Link href="/app/files?import=properties"><Upload aria-hidden /> Import from CSV</Link></Button> : undefined}
          />
        }
      />
      {archive.dialog}
    </>
  );
}

export function UnitsTable({ rows, showProperty = true, canEdit, canDelete, propertyId }: { rows: UnitRow[]; showProperty?: boolean; canEdit: boolean; canDelete: boolean; propertyId?: string }) {
  const router = useRouter();
  const archive = useArchive("unit");
  const columns = React.useMemo<ColumnDef<UnitRow, unknown>[]>(() => {
    const cols: ColumnDef<UnitRow, unknown>[] = [
      {
        accessorKey: "name",
        header: "Unit",
        cell: ({ row }) => (
          <Link href={`/app/rentals/units/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {row.original.name}
          </Link>
        ),
      },
    ];
    if (showProperty) cols.push({ accessorKey: "propertyName", header: "Property", filterFn: "equals" });
    cols.push(
      { accessorKey: "beds", header: "Beds", cell: ({ row }) => <span className="tabular">{row.original.beds ?? "—"}</span> },
      { accessorKey: "bathsTenths", header: "Baths", cell: ({ row }) => <span className="tabular">{formatBaths(row.original.bathsTenths)}</span> },
      { accessorKey: "sqft", header: "Sq ft", cell: ({ row }) => <span className="tabular">{row.original.sqft?.toLocaleString("en-US") ?? "—"}</span> },
      { accessorKey: "marketRentCents", header: "Market rent", cell: ({ row }) => <span className="tabular">{formatMoney(row.original.marketRentCents)}</span> },
      { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    );
    return cols;
  }, [showProperty]);
  const properties = [...new Set(rows.map((r) => r.propertyName))].sort();
  return (
    <>
      <DataTable
        tableId={showProperty ? "units" : "property-units"}
        label="Units"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search units"
        onRowClick={(r) => router.push(`/app/rentals/units/${r.id}`)}
        filters={showProperty && properties.length > 1 ? [{ columnId: "propertyName", label: "Properties", options: properties.map((p) => ({ value: p, label: p })) }] : []}
        rowActions={(r) => [
          { label: "Open", onSelect: () => router.push(`/app/rentals/units/${r.id}`) },
          ...(canDelete ? [{ label: "Archive", destructive: true, onSelect: () => archive.ask(r.id, r.name) }] : []),
        ]}
        empty={
          <EmptyState
            icon={<DoorOpen />}
            title="No units yet"
            description="Units are what you lease. Add them one at a time or import a spreadsheet."
            action={canEdit ? <Button asChild><Link href={propertyId ? `/app/new/unit?propertyId=${propertyId}` : "/app/new/unit"} scroll={false}><Plus aria-hidden /> Add unit</Link></Button> : undefined}
          />
        }
      />
      {archive.dialog}
    </>
  );
}

export type OwnerRow = { id: string; name: string; kind: string; email: string; phone: string; properties: number; propertyNames: string; portalStatus: string };

export function OwnersTable({ rows, canEdit, canDelete }: { rows: OwnerRow[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const archive = useArchive("owner");
  const columns = React.useMemo<ColumnDef<OwnerRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Owner",
        cell: ({ row }) => (
          <div>
            <Link href={`/app/people/owners/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.name}</Link>
            <div className="text-xs text-muted-foreground">{row.original.kind === "COMPANY" ? "Company" : "Individual"}</div>
          </div>
        ),
      },
      { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || <span className="text-muted-foreground">—</span> },
      { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone || <span className="text-muted-foreground">—</span> },
      { accessorKey: "properties", header: "Properties", cell: ({ row }) => <span className="tabular" title={row.original.propertyNames}>{row.original.properties}</span> },
      { accessorKey: "portalStatus", header: "Portal", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.portalStatus} /> },
      { accessorKey: "propertyNames", header: "Property names" },
    ],
    [],
  );
  return (
    <>
      <DataTable
        tableId="owners"
        label="Owners"
        data={rows}
        columns={columns}
        hiddenColumns={["propertyNames"]}
        getRowId={(r) => r.id}
        searchPlaceholder="Search owners or their properties"
        onRowClick={(r) => router.push(`/app/people/owners/${r.id}`)}
        rowActions={(r) => [
          { label: "Open", onSelect: () => router.push(`/app/people/owners/${r.id}`) },
          ...(canDelete ? [{ label: "Archive", destructive: true, onSelect: () => archive.ask(r.id, r.name) }] : []),
        ]}
        empty={
          <EmptyState
            icon={<UserRound />}
            title="Add your property owners"
            description="Owners get statements, distributions and their own portal. Link them to properties with an ownership percentage."
            action={canEdit ? <Button asChild><Link href="/app/new/owner" scroll={false}><Plus aria-hidden /> Add owner</Link></Button> : undefined}
          />
        }
      />
      {archive.dialog}
    </>
  );
}
