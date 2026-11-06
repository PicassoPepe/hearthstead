"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type Row,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, MoreHorizontal, Search, Bookmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RowAction<T> = { label: string; onSelect: (row: T) => void; destructive?: boolean; icon?: React.ReactNode };
export type FilterDef = { columnId: string; label: string; options: { value: string; label: string }[] };
export type BulkAction<T> = { label: string; onRun: (rows: T[]) => void | Promise<void>; destructive?: boolean };
type SavedView = { name: string; search: string; filters: ColumnFiltersState; sorting: SortingState };

const VIRTUALIZE_OVER = 200;
const ROW_HEIGHT = 44;

/**
 * DataTable: search, sort, filters, saved views, bulk select, row menu, CSV export,
 * pagination, empty state. Rows > 200 in "All" mode are virtualized.
 */
export function DataTable<T>({
  tableId,
  label,
  data,
  columns,
  getRowId,
  searchPlaceholder = "Search…",
  filters = [],
  rowActions,
  bulkActions,
  empty,
  onRowClick,
  csvFileName,
  initialSorting = [],
  hiddenColumns = [],
}: {
  tableId: string;
  /** Accessible table caption */
  label: string;
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  rowActions?: (row: T) => RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  empty: React.ReactNode;
  onRowClick?: (row: T) => void;
  csvFileName?: string;
  initialSorting?: SortingState;
  /** Columns kept for search and CSV export but not displayed. */
  hiddenColumns?: string[];
}) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 25 });
  const pageSize = pagination.pageSize;
  const setPageSize = (n: number) => setPagination({ pageIndex: 0, pageSize: n });
  const [views, setViews] = useSavedViews(tableId);

  const selectable = Boolean(bulkActions?.length);
  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    const cols: ColumnDef<T, unknown>[] = [];
    if (selectable) {
      cols.push({
        id: "__select",
        enableSorting: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all rows"
            className="size-4 accent-[var(--primary)]"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Select row"
            className="size-4 accent-[var(--primary)]"
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      });
    }
    cols.push(...columns);
    if (rowActions) {
      cols.push({
        id: "__actions",
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => <RowMenu row={row.original} actions={rowActions(row.original)} />,
      });
    }
    return cols;
  }, [columns, rowActions, selectable]);

  const all = pageSize === 0;
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      rowSelection,
      pagination: all ? { pageIndex: 0, pageSize: Math.max(data.length, 1) } : pagination,
    },
    onPaginationChange: (u) => {
      if (all) return;
      setPagination((prev) => (typeof u === "function" ? u(prev) : u));
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    initialState: { columnVisibility: Object.fromEntries(hiddenColumns.map((c) => [c, false])) },
    enableRowSelection: selectable,
    manualPagination: false,
    autoResetPageIndex: true,
  });
  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const virtualize = all && rows.length > VIRTUALIZE_OVER;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const exportCsv = () => {
    const cols = table.getAllLeafColumns().filter((c) => !c.id.startsWith("__"));
    const header = cols.map((c) => csvCell(typeof c.columnDef.header === "string" ? c.columnDef.header : c.id));
    const body = table.getFilteredRowModel().rows.map((r) => cols.map((c) => csvCell(r.getValue(c.id))));
    const csv = [header, ...body].map((l) => l.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFileName ?? tableId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = globalFilter !== "" || columnFilters.length > 0;

  const renderRow = (row: Row<T>, style?: React.CSSProperties) => (
    <tr
      key={row.id}
      style={style}
      data-state={row.getIsSelected() ? "selected" : undefined}
      className={cn("border-b border-border last:border-0 data-[state=selected]:bg-primary-soft/40", onRowClick && "cursor-pointer hover:bg-surface-muted")}
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className={cn("h-11 px-3 align-middle", cell.column.id.startsWith("__") && "w-10")}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  if (data.length === 0) return <>{empty}</>;

  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label={`Search ${label}`}
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        {filters.map((f) => (
          <NativeSelect
            key={f.columnId}
            aria-label={`Filter by ${f.label}`}
            className="w-auto min-w-36"
            value={(columnFilters.find((c) => c.id === f.columnId)?.value as string | undefined) ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setColumnFilters((prev) => [...prev.filter((p) => p.id !== f.columnId), ...(v ? [{ id: f.columnId, value: v }] : [])]);
            }}
          >
            <option value="">All {f.label.toLowerCase()}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        ))}
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={() => { setGlobalFilter(""); setColumnFilters([]); }}>
            <X aria-hidden /> Clear
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Bookmark aria-hidden /> Views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {views.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet</div> : null}
              {views.map((v) => (
                <DropdownMenuItem key={v.name} onSelect={() => { setGlobalFilter(v.search); setColumnFilters(v.filters); setSorting(v.sorting); }}>
                  {v.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  const name = window.prompt("Name this view");
                  if (name) setViews([...views.filter((v) => v.name !== name), { name, search: globalFilter, filters: columnFilters, sorting }]);
                }}
              >
                Save current view…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download aria-hidden /> Export CSV
          </Button>
        </div>
      </div>

      {/* Bulk bar */}
      {selectable && selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/40 px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.length} selected</span>
          {bulkActions!.map((b) => (
            <Button key={b.label} size="sm" variant={b.destructive ? "danger" : "secondary"} onClick={async () => { await b.onRun(selected); setRowSelection({}); }}>
              {b.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div ref={scrollRef} className={cn("overflow-x-auto", virtualize && "max-h-[70dvh] overflow-y-auto")}>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className={cn("bg-surface-muted/60 text-xs font-medium text-muted-foreground", virtualize && "sticky top-0 z-10 bg-surface-muted")}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  const canSort = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : canSort ? "none" : undefined}
                      className="h-10 whitespace-nowrap px-3 font-medium"
                    >
                      {h.isPlaceholder ? null : canSort ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 rounded hover:text-foreground">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sort === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : sort === "desc" ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No results match your search or filters.{" "}
                  <button type="button" className="font-medium text-primary underline" onClick={() => { setGlobalFilter(""); setColumnFilters([]); }}>
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : virtualize ? (
              <>
                <tr aria-hidden style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }} />
                {virtualizer.getVirtualItems().map((vi) => renderRow(rows[vi.index]!))}
                <tr aria-hidden style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }} />
              </>
            ) : (
              rows.map((r) => renderRow(r))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[13px] text-muted-foreground">
        <span aria-live="polite">
          {filteredCount === data.length ? `${data.length} total` : `${filteredCount} of ${data.length}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Rows
            <NativeSelect className="h-8 w-auto" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
              <option value={0}>All</option>
            </NativeSelect>
          </label>
          {!all ? (
            <>
              <span>
                Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
              </span>
              <Button variant="secondary" size="icon-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
                <ChevronLeft aria-hidden />
              </Button>
              <Button variant="secondary" size="icon-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
                <ChevronRight aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RowMenu<T>({ row, actions }: { row: T; actions: RowAction<T>[] }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Row actions" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} destructive={a.destructive} onSelect={() => a.onSelect(row)}>
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Saved views persist per table in localStorage (per-viewer convenience). */
function useSavedViews(tableId: string): [SavedView[], (v: SavedView[]) => void] {
  const key = `hs.views.${tableId}`;
  const [views, setViews] = React.useState<SavedView[]>([]);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setViews(JSON.parse(raw) as SavedView[]);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const save = (v: SavedView[]) => {
    setViews(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  };
  return [views, save];
}
