"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteWorkflowAction, saveWorkflowAction, toggleWorkflowAction } from "@/server/actions/platform";

type Cond = { field: string; op: string; value: string };
type Act = { type: string; params: Record<string, string> };
export type WorkflowDraft = { id?: string; name: string; trigger: string; conditions: Cond[]; actions: Act[]; active: boolean };
type Meta = { triggers: { key: string; label: string; fields: { key: string; label: string }[] }[]; actions: { key: string; label: string }[]; staff: { id: string; name: string }[] };

const OPS = [["eq", "is"], ["neq", "is not"], ["gt", "greater than"], ["lt", "less than"], ["contains", "contains"]] as const;
const PRESET: Record<string, Record<string, string>> = {
  SEND_EMAIL: { subject: "", body: "" }, SEND_SMS: { body: "" }, CREATE_TASK: { title: "", priority: "NORMAL", description: "" }, NOTIFY_STAFF: { userId: "", subject: "", body: "" },
};

/** Trigger → conditions → actions, with {{field}} placeholders. */
export function WorkflowBuilder({ meta, initial, trigger }: { meta: Meta; initial?: WorkflowDraft; trigger: React.ReactNode }) {
  const router = useRouter();
  const blank: WorkflowDraft = { name: "", trigger: meta.triggers[0]!.key, conditions: [], actions: [{ type: "NOTIFY_STAFF", params: { ...PRESET.NOTIFY_STAFF! } }], active: true };
  const [open, setOpen] = React.useState(false);
  const [w, setW] = React.useState<WorkflowDraft>(initial ?? blank);
  const [busy, setBusy] = React.useState(false);
  const fields = meta.triggers.find((t) => t.key === w.trigger)?.fields ?? [];
  const setAct = (i: number, p: Partial<Act>) => setW({ ...w, actions: w.actions.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  const setParam = (i: number, k: string, v: string) => setAct(i, { params: { ...w.actions[i]!.params, [k]: v } });
  return (
    <>
      <span onClickCapture={() => { setW(initial ?? blank); setOpen(true); }}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{initial ? "Edit workflow" : "New workflow"}</DialogTitle><DialogDescription>When the trigger happens and every condition is true, the actions run in order. Use {"{{field}}"} to insert details like {"{{title}}"} or {"{{amountCents}}"}.</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label="Name" required>{(a) => <Input {...a} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} placeholder="e.g. Urgent request → alert on-call" />}</Field>
            <Field label="When">{(a) => <NativeSelect {...a} value={w.trigger} onChange={(e) => setW({ ...w, trigger: e.target.value, conditions: [] })}>{meta.triggers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</NativeSelect>}</Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Only if (all must match)</legend>
              {w.conditions.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <NativeSelect aria-label={`Condition ${i + 1} field`} className="w-44" value={c.field} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</NativeSelect>
                  <NativeSelect aria-label={`Condition ${i + 1} operator`} className="w-36" value={c.op} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
                  <Input aria-label={`Condition ${i + 1} value`} className="w-40" value={c.value} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove condition ${i + 1}`} onClick={() => setW({ ...w, conditions: w.conditions.filter((_, j) => j !== i) })}><Trash2 aria-hidden /></Button>
                </div>
              ))}
              {fields.length ? <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => setW({ ...w, conditions: [...w.conditions, { field: fields[0]!.key, op: "eq", value: "" }] })}><Plus aria-hidden /> Add condition</Button> : null}
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">Then</legend>
              {w.actions.map((a, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <NativeSelect aria-label={`Action ${i + 1}`} value={a.type} onChange={(e) => setAct(i, { type: e.target.value, params: { ...PRESET[e.target.value]! } })}>{meta.actions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</NativeSelect>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove action ${i + 1}`} disabled={w.actions.length === 1} onClick={() => setW({ ...w, actions: w.actions.filter((_, j) => j !== i) })}><Trash2 aria-hidden /></Button>
                  </div>
                  {a.type === "NOTIFY_STAFF" ? <Field label="Who">{(x) => <NativeSelect {...x} value={a.params.userId ?? ""} onChange={(e) => setParam(i, "userId", e.target.value)}><option value="">Choose…</option>{meta.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>}</Field> : null}
                  {a.type === "CREATE_TASK" ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="Task title" className="sm:col-span-2">{(x) => <Input {...x} value={a.params.title ?? ""} onChange={(e) => setParam(i, "title", e.target.value)} />}</Field>
                      <Field label="Priority">{(x) => <NativeSelect {...x} value={a.params.priority ?? "NORMAL"} onChange={(e) => setParam(i, "priority", e.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</NativeSelect>}</Field>
                    </div>
                  ) : null}
                  {a.type === "SEND_EMAIL" || a.type === "NOTIFY_STAFF" ? <Field label="Subject">{(x) => <Input {...x} value={a.params.subject ?? ""} onChange={(e) => setParam(i, "subject", e.target.value)} />}</Field> : null}
                  {a.type !== "CREATE_TASK" ? <Field label="Message">{(x) => <Textarea {...x} rows={3} value={a.params.body ?? ""} onChange={(e) => setParam(i, "body", e.target.value)} />}</Field> : null}
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" className="justify-self-start" onClick={() => setW({ ...w, actions: [...w.actions, { type: "SEND_EMAIL", params: { ...PRESET.SEND_EMAIL! } }] })}><Plus aria-hidden /> Add action</Button>
            </fieldset>
            <label className="flex items-center gap-3 text-sm"><Switch checked={w.active} onCheckedChange={(v) => setW({ ...w, active: v })} aria-label="Active" /> Active</label>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              setBusy(true);
              const r = await saveWorkflowAction(w.id ?? null, w as never);
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
              router.refresh();
            }}>Save workflow</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkflowRowActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const run = async (p: Promise<{ ok: boolean; error?: string; message?: string }>) => { const r = await p; if (!r.ok) return void toast.error(r.error); toast.success(r.message ?? "Done"); router.refresh(); };
  return (
    <span className="flex items-center gap-2">
      <Switch checked={active} aria-label={active ? "Pause workflow" : "Turn workflow on"} onCheckedChange={(v) => run(toggleWorkflowAction(id, v))} />
      <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Delete this workflow?")) void run(deleteWorkflowAction(id)); }}>Delete</Button>
    </span>
  );
}
