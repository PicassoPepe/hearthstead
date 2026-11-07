import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowBuilder, WorkflowRowActions } from "@/components/platform/workflow-builder";
import { EVENT_LABEL, EVENT_TYPES } from "@/server/platform/events";
import { ACTION_LABEL, ACTION_TYPES, TRIGGER_FIELDS } from "@/server/platform/workflows";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "workflows", "view")) return <Forbidden what="workflows" />;
  const [flows, runs, staff] = await Promise.all([
    ctx.db.workflow.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } }),
    ctx.db.workflowRun.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { workflow: { select: { name: true } } } }),
    ctx.db.membership.findMany({ where: { status: "ACTIVE" }, include: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  const meta = {
    triggers: EVENT_TYPES.map((e) => ({ key: e, label: EVENT_LABEL[e], fields: TRIGGER_FIELDS[e] ?? [] })),
    actions: ACTION_TYPES.map((a) => ({ key: a, label: ACTION_LABEL[a] })),
    staff: staff.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email })),
  };
  const canEdit = can(ctx.permissions, "workflows", "edit");
  return (
    <>
      <PageHeader title="Workflows" description="Automate the routine: when something happens and conditions match, send messages or create tasks."
        actions={canEdit ? <WorkflowBuilder meta={meta} trigger={<Button><Plus aria-hidden /> New workflow</Button>} /> : null} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <ul className="grid content-start gap-3">
          {flows.map((f) => {
            const conds = f.conditions as { field: string; op: string; value: string }[];
            const acts = f.actions as { type: keyof typeof ACTION_LABEL; params: Record<string, string> }[];
            return (
              <li key={f.id} className="rounded-card border border-border bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="mr-auto font-semibold">{f.name}</h2>
                  {canEdit ? <WorkflowBuilder meta={meta} initial={{ id: f.id, name: f.name, trigger: f.trigger, conditions: conds, actions: acts, active: f.active }} trigger={<Button size="sm" variant="ghost" aria-label={`Edit ${f.name}`}>Edit</Button>} /> : null}
                  {canEdit ? <WorkflowRowActions id={f.id} active={f.active} /> : <Badge tone={f.active ? "success" : "neutral"}>{f.active ? "On" : "Paused"}</Badge>}
                </div>
                <p className="mt-2 text-sm"><Badge tone="primary">When</Badge> {EVENT_LABEL[f.trigger as keyof typeof EVENT_LABEL] ?? f.trigger}{conds.length ? <> · <Badge tone="outline">If</Badge> {conds.map((c) => `${c.field} ${c.op} “${c.value}”`).join(" and ")}</> : null}</p>
                <ol className="mt-1 list-decimal pl-5 text-sm text-muted-foreground">{acts.map((a, i) => <li key={i}>{ACTION_LABEL[a.type]}{a.params.title ? `: “${a.params.title}”` : a.params.subject ? `: “${a.params.subject}”` : ""}</li>)}</ol>
              </li>
            );
          })}
          {!flows.length ? <li className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No workflows yet. Try “When a tenant request is created and priority is URGENT → email the on-call manager”.</li> : null}
        </ul>
        <Card>
          <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center gap-2"><Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "neutral"}>{r.status === "SKIPPED" ? "Skipped" : r.status === "SUCCEEDED" ? "Ran" : "Failed"}</Badge><span className="font-medium">{r.workflow.name}</span></div>
                  <p className="text-xs text-muted-foreground">{r.createdAt.toLocaleString()} · {r.event}</p>
                  <ul className="text-xs">{(r.log as { action: string; status: string; detail?: string }[]).map((l, i) => <li key={i}>{l.action}: {l.detail ?? l.status}</li>)}</ul>
                </li>
              ))}
              {!runs.length ? <li className="text-muted-foreground">Nothing has run yet.</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
