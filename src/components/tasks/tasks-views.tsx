"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AlertTriangle, ListChecks, Plus } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES, TASK_TYPE_LABEL, categoryLabel } from "@/lib/maintenance";
import { setTaskStatusAction } from "@/server/actions/maintenance";
import type { TaskRow } from "@/server/maintenance/queries";
import { cn } from "@/lib/utils";

const PRIORITY_TONE = { LOW: "outline", NORMAL: "neutral", HIGH: "warning", URGENT: "danger" } as const;

export function PriorityBadge({ p }: { p: string }) {
  return (
    <Badge tone={PRIORITY_TONE[p as keyof typeof PRIORITY_TONE] ?? "neutral"}>
      {p === "URGENT" ? <AlertTriangle className="size-3" aria-hidden /> : null}
      {PRIORITY_LABEL[p as keyof typeof PRIORITY_LABEL] ?? p}
    </Badge>
  );
}

function Empty({ canEdit }: { canEdit: boolean }) {
  return (
    <EmptyState
      icon={<ListChecks />}
      title="Nothing here"
      description="Repairs, tenant requests and to-dos all show up here. Tenants can also report repairs from their own page."
      action={canEdit ? <Button asChild><Link href="/app/new/repair" scroll={false}><Plus aria-hidden /> Report a repair</Link></Button> : undefined}
      secondary={canEdit ? <Button asChild variant="secondary"><Link href="/app/new/task" scroll={false}>New to-do</Link></Button> : undefined}
    />
  );
}

export function TasksTable({ rows, canEdit, tableId = "tasks" }: { rows: TaskRow[]; canEdit: boolean; tableId?: string }) {
  const router = useRouter();
  const columns = React.useMemo<ColumnDef<TaskRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Task",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link href={`/app/tasks/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              <span className="tabular text-muted-foreground">#{row.original.number}</span> {row.original.title}
            </Link>
            <div className="text-xs text-muted-foreground">{TASK_TYPE_LABEL[row.original.type as keyof typeof TASK_TYPE_LABEL]}{row.original.category ? ` · ${categoryLabel(row.original.category)}` : ""}{row.original.subtasks ? ` · ${row.original.subtasks} subtasks` : ""}</div>
          </div>
        ),
      },
      { accessorKey: "where", header: "Property / unit" },
      { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { accessorKey: "priority", header: "Priority", filterFn: "equals", sortingFn: (a, b) => ["LOW", "NORMAL", "HIGH", "URGENT"].indexOf(a.original.priority) - ["LOW", "NORMAL", "HIGH", "URGENT"].indexOf(b.original.priority), cell: ({ row }) => <PriorityBadge p={row.original.priority} /> },
      { accessorKey: "type", header: "Type", filterFn: "equals", cell: ({ row }) => TASK_TYPE_LABEL[row.original.type as keyof typeof TASK_TYPE_LABEL] },
      { accessorKey: "vendor", header: "Vendor", filterFn: "equals", cell: ({ row }) => row.original.vendor || <span className="text-muted-foreground">—</span> },
      { accessorKey: "assignees", header: "Assignees", cell: ({ row }) => row.original.assignees || <span className="text-muted-foreground">Unassigned</span> },
      {
        accessorKey: "dueDate",
        header: "Due",
        cell: ({ row }) => (row.original.dueDate ? <span className={cn("tabular", row.original.overdue && "font-medium text-danger")}>{formatDate(row.original.dueDate)}{row.original.overdue ? " · overdue" : ""}</span> : <span className="text-muted-foreground">—</span>),
      },
    ],
    [],
  );
  const vendors = [...new Set(rows.map((r) => r.vendor).filter(Boolean))].sort();
  return (
    <DataTable
      tableId={tableId}
      label="Tasks"
      data={rows}
      columns={columns}
      hiddenColumns={["type"]}
      getRowId={(r) => r.id}
      searchPlaceholder="Search title, #number, property, vendor"
      onRowClick={(r) => router.push(`/app/tasks/${r.id}`)}
      filters={[
        { columnId: "type", label: "Types", options: Object.entries(TASK_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })) },
        { columnId: "status", label: "Statuses", options: TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
        { columnId: "priority", label: "Priorities", options: Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: l })) },
        ...(vendors.length ? [{ columnId: "vendor", label: "Vendors", options: vendors.map((v) => ({ value: v, label: v })) }] : []),
      ]}
      bulkActions={canEdit ? [
        { label: "Mark completed", onRun: async (sel) => { for (const t of sel) { const r = await setTaskStatusAction(t.id, "COMPLETED"); if (!r.ok) toast.error(`#${t.number}: ${r.error}`); } toast.success("Updated"); router.refresh(); } },
        { label: "Archive", destructive: true, onRun: async (sel) => { for (const t of sel) await setTaskStatusAction(t.id, "ARCHIVED"); toast.success(`${sel.length} archived`); router.refresh(); } },
      ] : undefined}
      rowActions={(r) => [{ label: "Open", onSelect: () => router.push(`/app/tasks/${r.id}`) }]}
      empty={<Empty canEdit={canEdit} />}
    />
  );
}

const BOARD: (typeof TASK_STATUSES)[number][] = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED"];

/** Kanban by status. Drag a card, or use its "Move to" select (keyboard/screen-reader friendly). Optimistic. */
export function TasksBoard({ rows, canMove }: { rows: TaskRow[]; canMove: boolean }) {
  const router = useRouter();
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const status = (t: TaskRow) => overrides[t.id] ?? t.status;

  const move = async (t: TaskRow, to: string) => {
    if (status(t) === to) return;
    const prev = status(t);
    setOverrides((o) => ({ ...o, [t.id]: to }));
    const r = await setTaskStatusAction(t.id, to as (typeof TASK_STATUSES)[number]);
    if (!r.ok) {
      setOverrides((o) => ({ ...o, [t.id]: prev }));
      return void toast.error(r.error);
    }
    toast.success(`#${t.number} moved to ${STATUS_LABEL[to as keyof typeof STATUS_LABEL]}`);
    router.refresh();
  };

  if (!rows.length) return <Empty canEdit={canMove} />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {BOARD.map((col) => {
        const cards = rows.filter((t) => status(t) === col);
        return (
          <section
            key={col}
            aria-labelledby={`col-${col}`}
            onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(col); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const t = rows.find((x) => x.id === dragId);
              if (t) void move(t, col);
            }}
            className={cn("flex min-h-40 flex-col rounded-card border bg-surface-muted/50 p-2", over === col ? "border-primary" : "border-border")}
          >
            <h2 id={`col-${col}`} className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
              {STATUS_LABEL[col]} <span className="tabular rounded-full bg-surface px-2 text-xs text-muted-foreground">{cards.length}</span>
            </h2>
            <ul className="grid gap-2">
              {cards.map((t) => (
                <li
                  key={t.id}
                  draggable={canMove}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  className={cn("rounded-lg border border-border bg-surface p-3 shadow-card", canMove && "cursor-grab", dragId === t.id && "opacity-50")}
                >
                  <Link href={`/app/tasks/${t.id}`} className="block text-sm font-medium hover:underline">
                    <span className="tabular text-muted-foreground">#{t.number}</span> {t.title}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{t.where}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <PriorityBadge p={t.priority} />
                    {t.vendor ? <Badge tone="outline">{t.vendor}</Badge> : null}
                    {t.dueDate ? <span className={cn("text-xs", t.overdue ? "font-medium text-danger" : "text-muted-foreground")}>Due {formatDate(t.dueDate)}</span> : null}
                  </div>
                  {canMove ? (
                    <NativeSelect aria-label={`Move #${t.number} to`} className="mt-2 h-8 text-xs" value={status(t)} onChange={(e) => void move(t, e.target.value)}>
                      {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </NativeSelect>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
