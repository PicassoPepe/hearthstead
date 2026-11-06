"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { UserPlus, Users } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Avatar } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { PropertyAccessButton } from "./property-access";
import { changeMemberRole, removeMember, restoreMember } from "@/server/actions/members";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  status: string;
  isSelf: boolean;
  invitedAt: string | null;
  propertyScope: string[];
};

export function MembersTable({ rows, roles, canEdit, canDelete, properties }: { rows: MemberRow[]; roles: { id: string; name: string }[]; canEdit: boolean; canDelete: boolean; properties: { id: string; name: string }[] }) {
  const router = useRouter();
  const [optimistic, setOptimistic] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<MemberRow | null>(null);

  const columns = React.useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.name} />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {row.original.name}
                {row.original.isSelf ? <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span> : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
            </div>
          </div>
        ),
      },
      { accessorKey: "email", header: "Email" },
      {
        accessorKey: "roleName",
        header: "Role",
        filterFn: "equals",
        cell: ({ row }) => {
          const m = row.original;
          const current = optimistic[m.id] ?? m.roleId;
          if (!canEdit || m.isSelf) return <span>{m.roleName}</span>;
          return (
            <NativeSelect
              aria-label={`Role for ${m.name}`}
              className="h-8 w-auto"
              value={current}
              onClick={(e) => e.stopPropagation()}
              onChange={async (e) => {
                const roleId = e.target.value;
                setOptimistic((o) => ({ ...o, [m.id]: roleId })); // optimistic
                const r = await changeMemberRole({ membershipId: m.id, roleId });
                if (r.ok) {
                  toast.success(`${m.name} is now ${roles.find((x) => x.id === roleId)?.name}`);
                  router.refresh();
                } else {
                  setOptimistic((o) => ({ ...o, [m.id]: m.roleId }));
                  toast.error(r.error);
                }
              }}
            >
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          );
        },
      },
      {
        id: "access",
        header: "Property access",
        accessorFn: (m) => (m.propertyScope.length ? `${m.propertyScope.length} properties` : "All properties"),
        cell: ({ row }) => (
          <PropertyAccessButton
            membershipId={row.original.id}
            memberName={row.original.name}
            scope={row.original.propertyScope}
            properties={properties}
            canEdit={canEdit && !row.original.isSelf}
          />
        ),
      },
      { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [canEdit, optimistic, roles, router, properties],
  );

  return (
    <>
      <DataTable
        tableId="members"
        label="Team members"
        data={rows}
        columns={columns}
        hiddenColumns={["email"]}
        getRowId={(r) => r.id}
        searchPlaceholder="Search by name or email"
        filters={[
          { columnId: "roleName", label: "Roles", options: roles.map((r) => ({ value: r.name, label: r.name })) },
          { columnId: "status", label: "Statuses", options: [{ value: "ACTIVE", label: "Active" }, { value: "INVITED", label: "Invited" }] },
        ]}
        rowActions={
          canDelete
            ? (m) => (m.isSelf ? [] : [{ label: "Remove from team", destructive: true, onSelect: () => setConfirm(m) }])
            : undefined
        }
        empty={
          <EmptyState
            icon={<Users />}
            title="Invite your team"
            description="Add property managers, bookkeepers and maintenance staff, each with the right permissions."
            action={<Button asChild><Link href="/app/new/user" scroll={false}><UserPlus aria-hidden /> Invite user</Link></Button>}
          />
        }
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.name ?? "member"}?`}
        description="They'll lose access to this organization immediately. You can undo this right after."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const m = confirm!;
          setConfirm(null);
          const r = await removeMember({ membershipId: m.id });
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
          toast.success(`${m.name} removed`, {
            action: {
              label: "Undo",
              onClick: async () => {
                const u = await restoreMember({ membershipId: m.id });
                if (u.ok) { toast.success(`${m.name} restored`); router.refresh(); } else toast.error(u.error);
              },
            },
          });
        }}
      />
    </>
  );
}
