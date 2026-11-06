"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSignature, Plus } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { LeaseRow } from "@/server/leasing/queries";

export function LeasesTable({ rows, tab, canEdit }: { rows: LeaseRow[]; tab: string; canEdit: boolean }) {
  const router = useRouter();
  const columns = React.useMemo<ColumnDef<LeaseRow, unknown>[]>(
    () => [
      {
        accessorKey: "label",
        header: "Lease",
        cell: ({ row }) => (
          <Link href={`/app/leasing/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.label}</Link>
        ),
      },
      { accessorKey: "tenants", header: "Tenants" },
      {
        id: "dates",
        header: "Dates",
        accessorFn: (r) => r.startDate,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular">
            {formatDate(row.original.startDate)} – {row.original.endDate ? formatDate(row.original.endDate) : <Badge tone="outline">Month-to-month</Badge>}
          </span>
        ),
      },
      {
        id: "expires",
        header: "Ends in",
        accessorFn: (r) => r.daysToEnd ?? 99999,
        cell: ({ row }) => {
          const d = row.original.daysToEnd;
          if (d == null || row.original.status === "ENDED") return <span className="text-muted-foreground">—</span>;
          if (d < 0) return <Badge tone="warning">Ended {-d}d ago (holdover)</Badge>;
          return <Badge tone={d <= 30 ? "danger" : d <= 60 ? "warning" : "neutral"}>{d} days</Badge>;
        },
      },
      { accessorKey: "rentCents", header: "Rent", cell: ({ row }) => <span className="tabular">{formatMoney(row.original.rentCents)}</span> },
      {
        accessorKey: "balanceCents",
        header: "Balance",
        cell: ({ row }) => <span className={`tabular ${row.original.balanceCents > 0 ? "font-semibold text-danger" : ""}`}>{formatMoney(row.original.balanceCents)}</span>,
      },
      { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: "propertyName", header: "Property", filterFn: "equals" },
    ],
    [],
  );
  const properties = [...new Set(rows.map((r) => r.propertyName))].sort();
  return (
    <DataTable
      tableId={`leases-${tab}`}
      label="Leases"
      data={rows}
      columns={columns}
      hiddenColumns={["propertyName"]}
      getRowId={(r) => r.id}
      searchPlaceholder="Search unit, tenant, property"
      onRowClick={(r) => router.push(`/app/leasing/${r.id}`)}
      initialSorting={tab === "expiring" ? [{ id: "expires", desc: false }] : []}
      filters={properties.length > 1 ? [{ columnId: "propertyName", label: "Properties", options: properties.map((p) => ({ value: p, label: p })) }] : []}
      rowActions={(r) => [{ label: "Open", onSelect: () => router.push(`/app/leasing/${r.id}`) }, { label: "Ledger", onSelect: () => router.push(`/app/leasing/${r.id}?tab=transactions`) }]}
      empty={
        <EmptyState
          icon={<FileSignature />}
          title={tab === "drafts" ? "No draft leases" : tab === "ended" ? "No ended leases yet" : tab === "expiring" ? "Nothing expiring soon" : "Create your first lease"}
          description="Leases connect tenants to units and drive rent, late fees, balances and occupancy."
          action={canEdit ? <Button asChild><Link href="/app/new/lease" scroll={false}><Plus aria-hidden /> New lease</Link></Button> : undefined}
        />
      }
    />
  );
}
