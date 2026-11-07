import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listTasks } from "@/server/maintenance/queries";
import { filesFor, notesFor } from "@/server/records/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/patterns/status-badge";
import { TasksTable } from "@/components/tasks/tasks-views";
import { VendorForm } from "@/components/tasks/vendor-form";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";
import { categoryLabel } from "@/lib/maintenance";

const TABS = ["overview", "work-orders", "bills", "notes", "files"] as const;

export default async function VendorPage({ params, searchParams }: { params: Promise<{ vendorId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { vendorId } = await params;
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "overview";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) notFound();
  const v = await ctx.db.vendor.findFirst({ where: { id: vendorId } });
  if (!v) notFound();
  const [tasks, bills] = await Promise.all([listTasks(ctx, { vendorId: v.id }), ctx.db.bill.findMany({ where: { vendorId: v.id }, orderBy: { billDate: "desc" } })]);
  const canEdit = can(ctx.permissions, "people", "edit");
  const base = `/app/people/vendors/${v.id}`;
  const ytd = bills.filter((b) => b.billDate.getUTCFullYear() === new Date().getUTCFullYear() && b.status !== "VOID").reduce((s, b) => s + b.totalCents, 0);
  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/people/vendors" className="hover:underline">Vendors</Link> / {v.name}</>}
        title={v.name}
        status={<div className="flex flex-wrap gap-1">{v.trades.map((t) => <Badge key={t} tone="outline">{categoryLabel(t)}</Badge>)}</div>}
        subtitle={[v.contactName, v.email, v.phone].filter(Boolean).join(" · ") || undefined}
        stats={[
          { label: "Open work orders", value: tasks.filter((t) => !["COMPLETED", "ARCHIVED"].includes(t.status)).length },
          { label: "Billed this year", value: formatMoney(ytd) },
          { label: "W-9", value: v.w9OnFile ? "On file" : "Missing" },
          { label: "Insurance", value: v.insuranceExpires ? formatDate(v.insuranceExpires) : "—" },
        ]}
      />
      <EntityTabs base={base} active={tab} tabs={[{ id: "overview", label: "Overview" }, { id: "work-orders", label: "Work orders", count: tasks.length }, { id: "bills", label: "Bills", count: bills.length }, { id: "notes", label: "Notes" }, { id: "files", label: "Files" }]} />
      {tab === "overview" ? (
        <Card className="max-w-3xl">
          <CardHeader><CardTitle>{canEdit ? "Edit vendor" : "Details"}</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <VendorForm id={v.id} initial={{ name: v.name, contactName: v.contactName ?? "", email: v.email ?? "", phone: v.phone ?? "", trades: v.trades, taxIdLast4: v.taxIdLast4 ?? "", send1099: v.send1099, w9OnFile: v.w9OnFile, insuranceExpires: v.insuranceExpires ? toISODate(v.insuranceExpires) : "" }} />
            ) : <p className="text-sm">{v.email ?? "No email"}</p>}
          </CardContent>
        </Card>
      ) : tab === "work-orders" ? (
        <TasksTable rows={tasks} canEdit={false} tableId="vendor-tasks" />
      ) : tab === "bills" ? (
        <div className="rounded-card border border-border bg-surface">
          {bills.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No bills yet. Turn a work order&apos;s invoice into a bill from the work order.</p> : (
            <table className="w-full text-sm">
              <caption className="sr-only">Bills</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Bill", "Date", "Due", "Status", "Amount"].map((h) => <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="px-4 py-2">{b.billNumber ? `#${b.billNumber}` : "—"} {b.memo}</td>
                    <td className="px-4 py-2 tabular">{formatDate(b.billDate)}</td>
                    <td className="px-4 py-2 tabular">{formatDate(b.dueDate)}</td>
                    <td className="px-4 py-2"><StatusBadge status={b.status === "OPEN" ? "PENDING" : b.status === "PAID" ? "SUCCEEDED" : b.status} label={b.status.replace("_", " ").toLowerCase()} /></td>
                    <td className="px-4 py-2 text-right tabular">{formatMoney(b.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === "notes" ? (
        <NotesPanel entityType="Vendor" entityId={v.id} notes={await notesFor(ctx, "Vendor", v.id)} canEdit={canEdit} />
      ) : (
        <FilesPanel entityType="Vendor" entityId={v.id} files={await filesFor(ctx, "Vendor", v.id)} canEdit={canEdit} />
      )}
    </>
  );
}
