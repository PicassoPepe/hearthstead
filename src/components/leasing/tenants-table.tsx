"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Users } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export type TenantRow = { id: string; name: string; email: string; phone: string; unit: string; leaseId: string | null; leaseStatus: string; balanceCents: number; portalStatus: string };

export function TenantsTable({ rows, canEdit }: { rows: TenantRow[]; canEdit: boolean }) {
  const router = useRouter();
  const columns = React.useMemo<ColumnDef<TenantRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Tenant", cell: ({ row }) => <Link href={`/app/people/tenants/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.name}</Link> },
      { accessorKey: "unit", header: "Unit", cell: ({ row }) => row.original.unit || <span className="text-muted-foreground">No lease</span> },
      { accessorKey: "leaseStatus", header: "Lease", filterFn: "equals", cell: ({ row }) => (row.original.leaseStatus === "NO_LEASE" ? <span className="text-muted-foreground">—</span> : <StatusBadge status={row.original.leaseStatus} />) },
      { accessorKey: "balanceCents", header: "Balance", cell: ({ row }) => <span className={`tabular ${row.original.balanceCents > 0 ? "font-semibold text-danger" : ""}`}>{formatMoney(row.original.balanceCents)}</span> },
      { accessorKey: "email", header: "Email" },
      { accessorKey: "phone", header: "Phone" },
      { accessorKey: "portalStatus", header: "Portal", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.portalStatus} /> },
    ],
    [],
  );
  return (
    <DataTable
      tableId="tenants"
      label="Tenants"
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search name, email, unit"
      onRowClick={(r) => router.push(`/app/people/tenants/${r.id}`)}
      filters={[
        { columnId: "leaseStatus", label: "Lease statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "EVICTION", label: "Eviction" }, { value: "ENDED", label: "Ended" }, { value: "DRAFT", label: "Draft" }] },
        { columnId: "portalStatus", label: "Portal statuses", options: [{ value: "NOT_INVITED", label: "Not invited" }, { value: "INVITED", label: "Invited" }, { value: "ACTIVE", label: "Active" }] },
      ]}
      rowActions={(r) => [
        { label: "Open", onSelect: () => router.push(`/app/people/tenants/${r.id}`) },
        ...(r.leaseId ? [{ label: "Open lease", onSelect: () => router.push(`/app/leasing/${r.leaseId}`) }] : []),
      ]}
      empty={
        <EmptyState
          icon={<Users />}
          title="No tenants yet"
          description="Tenants are added when you create a lease, or on their own here."
          action={canEdit ? <Button asChild><Link href="/app/new/lease" scroll={false}><Plus aria-hidden /> New lease</Link></Button> : undefined}
          secondary={canEdit ? <Button asChild variant="secondary"><Link href="/app/new/tenant" scroll={false}>Add tenant only</Link></Button> : undefined}
        />
      }
    />
  );
}
