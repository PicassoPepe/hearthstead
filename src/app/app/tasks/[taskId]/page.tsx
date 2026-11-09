import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { taskDetail, taskFormOptions } from "@/server/maintenance/queries";
import { filesFor } from "@/server/records/queries";
import { orgToday } from "@/server/leasing/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilesPanel } from "@/components/records/files-panel";
import { PriorityBadge } from "@/components/tasks/tasks-views";
import { ActivityFeed, BillFromInvoice, InspectionChecklist, TaskDetailsForm, TaskStatusSelect } from "@/components/tasks/task-panels";
import { formatMoney } from "@/lib/money";
import { formatDate, toISODate } from "@/lib/dates";
import { STATUS_LABEL, TASK_TYPE_LABEL, categoryLabel } from "@/lib/maintenance";

export async function generateMetadata({ params }: { params: Promise<{ taskId: string }> }) {
  const ctx = await requireContext();
  const t = await ctx.db.task.findFirst({ where: { id: (await params).taskId }, select: { number: true, title: true } });
  return { title: t ? `#${t.number} ${t.title}` : "Task" };
}

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "tasks", "view")) notFound();
  const d = await taskDetail(ctx, taskId);
  if (!d) notFound();
  const { task: t } = d;
  const isVendor = ctx.membership.roleKey === "VENDOR";
  const canEdit = can(ctx.permissions, "tasks", "edit") && !isVendor;
  const [opts, photos, today, expense] = await Promise.all([
    canEdit ? taskFormOptions(ctx) : null,
    filesFor(ctx, "Task", t.id),
    orgToday(ctx),
    ctx.db.account.findMany({ where: { type: "EXPENSE", active: true }, orderBy: { code: "asc" } }),
  ]);
  const where = d.property ? `${d.property.name}${d.unit && d.unit.name !== "Main" ? ` · ${d.unit.name}` : ""}` : "No property";
  const images = photos.filter((f) => f.contentType?.startsWith("image/"));
  const repairs = expense.find((a) => a.systemKey === "REPAIRS") ?? expense[0];

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/tasks" className="hover:underline">Repairs</Link>{t.parent ? <> / <Link href={`/app/tasks/${t.parent.id}`} className="hover:underline">#{t.parent.number}</Link></> : null} / #{t.number}</>}
        title={`#${t.number} ${t.title}`}
        status={<><StatusBadge status={t.status} label={STATUS_LABEL[t.status]} /> <PriorityBadge p={t.priority} /></>}
        subtitle={<>{TASK_TYPE_LABEL[t.type]} · {where}{t.category ? ` · ${categoryLabel(t.category)}` : ""}</>}
        stats={[
          { label: "Due", value: t.dueDate ? formatDate(t.dueDate) : "—" },
          { label: "Who\u2019s fixing it", value: t.vendor?.name ?? "Not chosen yet" },
          { label: "Estimate", value: t.estimateCents != null ? formatMoney(t.estimateCents) : "—" },
          { label: "Staff on it", value: d.assigneeNames.join(", ") || "No one yet" },
        ]}
        actions={
          <>
            {canEdit || isVendor ? <TaskStatusSelect taskId={t.id} status={t.status} canArchive={canEdit} /> : null}
            {canEdit && t.type !== "INSPECTION" ? <Button asChild variant="secondary"><Link href={`/app/new/task?parentTaskId=${t.id}${t.propertyId ? `&propertyId=${t.propertyId}` : ""}`} scroll={false}><Plus aria-hidden /> Subtask</Link></Button> : null}
            {can(ctx.permissions, "accounting", "edit") && t.vendorId && !t.billId && !isVendor && repairs ? (
              <BillFromInvoice taskId={t.id} today={toISODate(today)} estimateCents={t.estimateCents} defaultAccountId={repairs.id} expenseAccounts={expense.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} />
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 lg:col-span-2">
          {images.length ? (
            <Card>
              <CardHeader><CardTitle>Photos ({images.length})</CardTitle></CardHeader>
              <CardContent>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="repair-photos">
                  {images.map((f) => (
                    <li key={f.id}>
                      <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${f.id}`} alt={f.name} loading="lazy" className="aspect-square w-full object-cover transition hover:opacity-90" />
                        <span className="sr-only"> (open full size in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Tap a photo to see it full size.</p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>What&apos;s wrong</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="whitespace-pre-wrap">{t.description || <span className="text-muted-foreground">No description.</span>}</p>
              {t.type === "TENANT_REQUEST" ? (
                <dl className="grid gap-2 rounded-lg bg-surface-muted p-3 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Requested by</dt><dd>{d.tenant ? <Link href={`/app/people/tenants/${d.tenant.id}`} className="font-medium hover:underline">{d.tenant.name}</Link> : "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Permission to enter</dt><dd>{t.permissionToEnter == null ? "—" : t.permissionToEnter ? "Yes" : "No — call first"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Preferred times</dt><dd>{t.preferredTimes ?? "—"}</dd></div>
                </dl>
              ) : null}
              {d.bill ? <p><Badge tone="success">Bill {d.bill.billNumber ? `#${d.bill.billNumber}` : ""} {formatMoney(d.bill.totalCents)} · {d.bill.status.toLowerCase()}</Badge></p> : null}
              {d.lease ? <p>Lease: <Link href={`/app/leasing/${t.leaseId}`} className="font-medium hover:underline">open lease</Link></p> : null}
            </CardContent>
          </Card>

          {t.type === "INSPECTION" ? (
            <Card>
              <CardHeader><CardTitle>Inspection checklist</CardTitle></CardHeader>
              <CardContent>
                <InspectionChecklist taskId={t.id} items={t.items} summary={t.aiSummary} canEdit={canEdit} canAi={canEdit && can(ctx.permissions, "ai", "view")} />
              </CardContent>
            </Card>
          ) : null}

          {t.subtasks.length ? (
            <Card>
              <CardHeader><CardTitle>Subtasks</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {t.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/app/tasks/${s.id}`} className="hover:underline">#{s.number} {s.title}</Link>
                      <StatusBadge status={s.status} label={STATUS_LABEL[s.status]} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Add photos or files</CardTitle></CardHeader>
            <CardContent><FilesPanel entityType="Task" entityId={t.id} files={photos} canEdit={canEdit || isVendor} /></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Notes & updates</CardTitle></CardHeader>
            <CardContent>
              <ActivityFeed
                taskId={t.id}
                canComment={canEdit || isVendor}
                canPublic={canEdit && t.type === "TENANT_REQUEST"}
                items={t.activities.map((a) => ({ id: a.id, kind: a.kind, body: a.body, public: a.public, actorName: a.actorName, at: a.createdAt.toISOString() }))}
              />
            </CardContent>
          </Card>
        </div>
        {canEdit && opts ? (
          <Card className="h-fit">
            <CardHeader><CardTitle>Manage</CardTitle></CardHeader>
            <CardContent>
              <TaskDetailsForm
                taskId={t.id}
                vendors={opts.vendors}
                members={opts.members}
                initial={{ priority: t.priority, dueDate: t.dueDate ? toISODate(t.dueDate) : "", vendorId: t.vendorId ?? "", assigneeIds: t.assignees.map((a) => a.userId), estimateCents: t.estimateCents }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
