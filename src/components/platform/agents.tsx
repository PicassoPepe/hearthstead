"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { decideAgentActionAction, runAgentsNowAction, saveAgentAction } from "@/server/actions/platform";

type Cfg = { agent: "RECEPTIONIST" | "MAINTENANCE" | "RENEWALS"; label: string; description: string; enabled: boolean; mode: string; threshold: number; maxAutoIncreasePct?: number; lastRunAt: string | null };

export function AgentCards({ configs, canEdit }: { configs: Cfg[]; canEdit: boolean }) {
  const router = useRouter();
  return (
    <div className="grid gap-3">
      {canEdit ? <Button className="justify-self-start" variant="secondary" onClick={async () => { const r = await runAgentsNowAction(); if (!r.ok) return void toast.error(r.error); toast.success(`Agents ran — ${r.data} new item${r.data === 1 ? "" : "s"}`); router.refresh(); }}><Play aria-hidden /> Run agents now</Button> : null}
      <div className="grid gap-3 lg:grid-cols-3">{configs.map((c) => <AgentCard key={c.agent} c={c} canEdit={canEdit} />)}</div>
    </div>
  );
}

function AgentCard({ c, canEdit }: { c: Cfg; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState({ enabled: c.enabled, mode: c.mode as "AUTO" | "APPROVAL", threshold: c.threshold, maxAutoIncreasePct: c.maxAutoIncreasePct ?? 5 });
  const save = async (next = f) => { setF(next); const r = await saveAgentAction(c.agent, { ...next, maxAutoIncreasePct: c.agent === "RENEWALS" ? next.maxAutoIncreasePct : undefined }); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); };
  return (
    <section aria-labelledby={`ag-${c.agent}`} className="grid content-start gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start gap-2">
        <div className="flex-1"><h3 id={`ag-${c.agent}`} className="font-semibold">{c.label}</h3><p className="text-sm text-muted-foreground">{c.description}</p></div>
        <Switch checked={f.enabled} disabled={!canEdit} aria-label={`Turn ${c.label} agent ${f.enabled ? "off" : "on"}`} onCheckedChange={(v) => save({ ...f, enabled: v })} />
      </div>
      <Field label="Mode">{(a) => <NativeSelect {...a} disabled={!canEdit} value={f.mode} onChange={(e) => save({ ...f, mode: e.target.value as "AUTO" })}><option value="APPROVAL">Propose — I approve each one</option><option value="AUTO">Act automatically above the threshold</option></NativeSelect>}</Field>
      {f.mode === "AUTO" ? <Field label="Confidence threshold (%)" description="Below this it still asks you.">{(a) => <Input {...a} type="number" min={50} max={100} disabled={!canEdit} value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} onBlur={() => save()} />}</Field> : null}
      {c.agent === "RENEWALS" && f.mode === "AUTO" ? <Field label="Max automatic increase (%)">{(a) => <Input {...a} type="number" min={0} max={20} disabled={!canEdit} value={f.maxAutoIncreasePct} onChange={(e) => setF({ ...f, maxAutoIncreasePct: Number(e.target.value) })} onBlur={() => save()} />}</Field> : null}
      <p className="text-xs text-muted-foreground">{c.lastRunAt ? `Last ran ${new Date(c.lastRunAt).toLocaleString()}` : "Hasn't run yet"}</p>
    </section>
  );
}

export function AgentActivity({ actions, canEdit }: { actions: { id: string; agent: string; kind: string; summary: string; confidence: number; status: string; result: string | null; createdAt: string; preview: string | null }[]; canEdit: boolean }) {
  const router = useRouter();
  const decide = async (id: string, approve: boolean) => { const r = await decideAgentActionAction(id, approve); if (!r.ok) return void toast.error(r.error); toast.success(r.data); router.refresh(); };
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
      {actions.map((a) => (
        <li key={a.id} className="grid gap-1 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="outline">{a.agent.toLowerCase()}</Badge>
            <span className="flex-1 font-medium">{a.summary}</span>
            <Badge tone={a.confidence >= 80 ? "success" : "warning"}>{a.confidence}% confident</Badge>
            <Badge tone={a.status === "EXECUTED" ? "success" : a.status === "FAILED" ? "danger" : a.status === "REJECTED" ? "neutral" : "info"}>{a.status === "PROPOSED" ? "Needs approval" : a.status.toLowerCase()}</Badge>
          </div>
          {a.preview ? <p className="whitespace-pre-wrap rounded bg-surface-muted p-2 text-xs">{a.preview}</p> : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{new Date(a.createdAt).toLocaleString()}{a.result ? ` · ${a.result}` : ""}</span>
            {canEdit && a.status === "PROPOSED" ? <span className="ml-auto flex gap-2"><Button size="sm" onClick={() => decide(a.id, true)} aria-label={`Approve: ${a.summary}`}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(a.id, false)} aria-label={`Reject: ${a.summary}`}>Reject</Button></span> : null}
          </div>
        </li>
      ))}
      {!actions.length ? <li className="p-6 text-center text-sm text-muted-foreground">No agent activity yet. Turn an agent on and run it.</li> : null}
    </ul>
  );
}
