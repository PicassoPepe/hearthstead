import Link from "next/link";
import { Columns3, List, Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listTasks } from "@/server/maintenance/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { TasksBoard, TasksTable } from "@/components/tasks/tasks-views";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "tasks", "view")) return <Forbidden what="tasks" />;
  const view = sp.view === "board" ? "board" : "table";
  const mine = sp.mine === "1";
  const all = await listTasks(ctx, { status: { not: "ARCHIVED" } });
  const rows = mine ? all.filter((t) => t.assigneeIds.includes(ctx.user.id)) : all;
  const open = all.filter((t) => t.status !== "COMPLETED");
  const isVendor = ctx.membership.roleKey === "VENDOR";
  const canEdit = can(ctx.permissions, "tasks", "edit") && !isVendor;
  const q = (v: string, m: boolean) => `/app/tasks?view=${v}${m ? "&mine=1" : ""}`;
  return (
    <>
      <PageHeader
        title={isVendor ? "Your work orders" : "Tasks"}
        description={isVendor ? "Work orders assigned to your company." : "Tasks, tenant requests, work orders and inspections."}
        actions={
          canEdit ? (
            <>
              <Button asChild variant="secondary"><Link href="/app/new/work-order" scroll={false}>New work order</Link></Button>
              <Button asChild><Link href="/app/new/task" scroll={false}><Plus aria-hidden /> New task</Link></Button>
            </>
          ) : null
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={open.length} />
        <StatCard label="Tenant requests" value={open.filter((t) => t.type === "TENANT_REQUEST").length} hint="Open" />
        <StatCard label="Urgent" value={open.filter((t) => t.priority === "URGENT").length} />
        <StatCard label="Overdue" value={open.filter((t) => t.overdue).length} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="View" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {[["table", "Table", List], ["board", "Board", Columns3]].map(([v, l, Icon]) => {
            const I = Icon as typeof List;
            return (
              <Link key={v as string} href={q(v as string, mine)} aria-current={view === v ? "page" : undefined} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground")}>
                <I className="size-4" aria-hidden /> {l as string}
              </Link>
            );
          })}
        </nav>
        {!isVendor ? (
          <Link href={q(view, !mine)} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", mine ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {mine ? "✓ " : ""}Assigned to me<span className="sr-only">{mine ? " (filter on — select to show everyone's tasks)" : " (filter off)"}</span>
          </Link>
        ) : null}
      </div>
      {view === "board" ? <TasksBoard rows={rows} canMove={can(ctx.permissions, "tasks", "edit") || isVendor} /> : <TasksTable rows={rows} canEdit={canEdit} />}
    </>
  );
}
