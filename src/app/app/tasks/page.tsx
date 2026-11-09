import { ListChecks as ListChecksIcon } from "lucide-react";
import Link from "next/link";
import { Columns3, List, Plus, Wrench } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listTasks } from "@/server/maintenance/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { PageHelp } from "@/components/patterns/big-actions";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { TasksBoard, TasksTable } from "@/components/tasks/tasks-views";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string; show?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "tasks", "view")) return <Forbidden what="tasks" />;
  const view = sp.view === "board" ? "board" : "table";
  const mine = sp.mine === "1";
  const all = await listTasks(ctx, { status: { not: "ARCHIVED" } });
  const open = all.filter((t) => t.status !== "COMPLETED");
  const show = sp.show === "emergencies" || sp.show === "requests" ? sp.show : null;
  const shown = show === "emergencies" ? open.filter((t) => t.priority === "URGENT") : show === "requests" ? open.filter((t) => t.type === "TENANT_REQUEST") : all;
  const rows = mine ? shown.filter((t) => t.assigneeIds.includes(ctx.user.id)) : shown;
  const isVendor = ctx.membership.roleKey === "VENDOR";
  const canEdit = can(ctx.permissions, "tasks", "edit") && !isVendor;
  const q = (v: string, m: boolean, keep = false) => `/app/tasks?view=${v}${m ? "&mine=1" : ""}${keep && sp.show ? `&show=${sp.show}` : ""}`;
  return (
    <>
      <PageHeader icon={<ListChecksIcon aria-hidden />}
        title={isVendor ? "Your work orders" : "Repairs & to-dos"}
        actions={
          canEdit ? (
            <>
              <Button asChild variant="secondary"><Link href="/app/new/task" scroll={false}><Plus aria-hidden /> New task</Link></Button>
              <Button asChild size="lg"><Link href="/app/new/repair" scroll={false}><Wrench aria-hidden /> Report a repair</Link></Button>
            </>
          ) : null
        }
      />
      <PageHelp>{isVendor ? "Jobs assigned to your company. Open one to update it or add photos." : "Every repair request — from tenants, owners or your team — plus other to-dos. Tenants' photos show on each request. Click a repair to see it, assign a repair company, or mark it done."}</PageHelp>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Not finished" value={open.length} href="/app/tasks" />
        <StatCard label="From tenants" value={open.filter((t) => t.type === "TENANT_REQUEST").length} hint="Not finished" href="/app/tasks?show=requests" />
        <StatCard label="Emergencies" value={open.filter((t) => t.priority === "URGENT").length} hint="Not finished" href="/app/tasks?show=emergencies" />
        <StatCard label="Late" value={open.filter((t) => t.overdue).length} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="View" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {[["table", "List", List], ["board", "Board", Columns3]].map(([v, l, Icon]) => {
            const I = Icon as typeof List;
            return (
              <Link key={v as string} href={q(v as string, mine, true)} aria-current={view === v ? "page" : undefined} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground")}>
                <I className="size-4" aria-hidden /> {l as string}
              </Link>
            );
          })}
        </nav>
        {!isVendor ? (
          <Link href={q(view, !mine, true)} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", mine ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {mine ? "✓ " : ""}Assigned to me<span className="sr-only">{mine ? " (filter on — select to show everyone's tasks)" : " (filter off)"}</span>
          </Link>
        ) : null}
      </div>
      {show ? (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-primary-soft/50 px-4 py-2.5 text-sm">
          Showing only <strong>{show === "emergencies" ? "emergency repairs that aren't finished" : "tenant requests that aren't finished"}</strong>.
          <Link href={q(view, mine)} className="font-medium text-primary underline-offset-4 hover:underline">Show everything</Link>
        </p>
      ) : null}
      {view === "board" ? <TasksBoard rows={rows} canMove={can(ctx.permissions, "tasks", "edit") || isVendor} /> : <TasksTable rows={rows} canEdit={canEdit} />}
    </>
  );
}
