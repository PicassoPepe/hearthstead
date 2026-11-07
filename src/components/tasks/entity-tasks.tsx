import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import type { AppContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listTasks } from "@/server/maintenance/queries";
import { Button } from "@/components/ui/button";
import { TasksTable } from "./tasks-views";

/** Tasks tab for any record (property, unit, lease, tenant, owner). */
export async function EntityTasks({ ctx, where, newHref, tableId }: { ctx: AppContext; where: Prisma.TaskWhereInput; newHref: string; tableId: string }) {
  if (!can(ctx.permissions, "tasks", "view")) return <p className="text-sm text-muted-foreground">Your role doesn&apos;t include tasks.</p>;
  const rows = await listTasks(ctx, where);
  const canEdit = can(ctx.permissions, "tasks", "edit") && ctx.membership.roleKey !== "VENDOR";
  return (
    <div className="grid gap-3">
      {canEdit && rows.length ? (
        <div><Button asChild variant="secondary"><Link href={newHref} scroll={false}><Plus aria-hidden /> New task</Link></Button></div>
      ) : null}
      <TasksTable rows={rows} canEdit={canEdit} tableId={tableId} />
    </div>
  );
}
