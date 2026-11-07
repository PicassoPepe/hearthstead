"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, MessageSquare, Sparkles, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONDITIONS, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, TASK_STATUSES } from "@/lib/maintenance";
import { billFromWorkOrder, commentAction, saveInspectionItemAction, setTaskStatusAction, summarizeInspectionAction, updateTaskAction } from "@/server/actions/maintenance";
import { cn } from "@/lib/utils";

/** Status select with optimistic update and rollback on error. */
export function TaskStatusSelect({ taskId, status, canArchive }: { taskId: string; status: string; canArchive: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(status);
  React.useEffect(() => setValue(status), [status]);
  return (
    <NativeSelect
      aria-label="Status"
      className="w-auto"
      value={value}
      onChange={async (e) => {
        const prev = value;
        const to = e.target.value as (typeof TASK_STATUSES)[number];
        setValue(to);
        const r = await setTaskStatusAction(taskId, to);
        if (!r.ok) {
          setValue(prev);
          return void toast.error(r.error);
        }
        toast.success(`Status: ${STATUS_LABEL[to]}`);
        router.refresh();
      }}
    >
      {TASK_STATUSES.filter((s) => canArchive || s !== "ARCHIVED").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
    </NativeSelect>
  );
}

export function TaskDetailsForm({
  taskId, initial, vendors, members,
}: {
  taskId: string;
  initial: { priority: string; dueDate: string; vendorId: string; assigneeIds: string[]; estimateCents: number | null };
  vendors: { id: string; name: string; hasEmail: boolean }[];
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [notify, setNotify] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const vendorChanged = v.vendorId !== initial.vendorId && v.vendorId;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await updateTaskAction(taskId, { priority: v.priority, dueDate: v.dueDate || null, vendorId: v.vendorId || null, assigneeIds: v.assigneeIds, estimateCents: v.estimateCents, notifyVendor: notify });
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Task updated");
        router.refresh();
      }}
    >
      <Field label="Priority">
        {(a) => (
          <NativeSelect {...a} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </NativeSelect>
        )}
      </Field>
      <Field label="Due date">{(a) => <Input {...a} type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />}</Field>
      <Field label="Vendor">
        {(a) => (
          <NativeSelect {...a} value={v.vendorId} onChange={(e) => setV({ ...v, vendorId: e.target.value })}>
            <option value="">No vendor</option>
            {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </NativeSelect>
        )}
      </Field>
      {vendorChanged ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the work order to the vendor
        </label>
      ) : null}
      <Field label="Cost estimate">{(a) => <MoneyInput {...a} valueCents={v.estimateCents} onChangeCents={(c) => setV({ ...v, estimateCents: c })} />}</Field>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Assignees</legend>
        <div className="grid gap-1">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.assigneeIds.includes(m.id)} onChange={(e) => setV({ ...v, assigneeIds: e.target.checked ? [...v.assigneeIds, m.id] : v.assigneeIds.filter((x) => x !== m.id) })} />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button>
    </form>
  );
}

export type ActivityView = { id: string; kind: string; body: string; public: boolean; actorName: string | null; at: string };
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ActivityFeed({ taskId, items, canComment, canPublic }: { taskId: string; items: ActivityView[]; canComment: boolean; canPublic: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [isPublic, setIsPublic] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-4">
      <ol className="relative space-y-4 border-l border-border pl-5">
        {items.map((a) => (
          <li key={a.id} className="relative">
            <span aria-hidden className={cn("absolute -left-[26px] top-1 size-3 rounded-full border-2 border-surface", a.kind === "COMMENT" ? "bg-info" : "bg-primary")} />
            <div className={cn("text-sm", a.kind === "COMMENT" && "rounded-lg bg-surface-muted px-3 py-2")}>
              {a.kind === "COMMENT" ? <MessageSquare className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden /> : null}
              <span className="whitespace-pre-wrap">{a.body}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <time dateTime={a.at}>{fmt.format(new Date(a.at))}</time> · {a.actorName ?? "System"}
              {a.public ? <Badge tone="info"><Globe className="size-3" aria-hidden /> Tenant can see</Badge> : <Badge tone="outline"><Lock className="size-3" aria-hidden /> Internal</Badge>}
            </div>
          </li>
        ))}
      </ol>
      {canComment ? (
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await commentAction(taskId, body, isPublic);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            setBody("");
            toast.success(isPublic ? "Reply sent to the tenant" : "Comment added");
            router.refresh();
          }}
        >
          <label htmlFor="task-comment" className="text-sm font-medium">Add a comment</label>
          <Textarea id="task-comment" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            {canPublic ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Visible to the tenant" /> Visible to the tenant
              </label>
            ) : null}
            <Button type="submit" className="ml-auto" loading={busy} disabled={!body.trim()}>Post</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

type Item = { id: string; room: string; item: string; condition: string | null; note: string | null };

/** Room-by-room checklist: condition (radio group, not color-only) + note per item. Saves on change. */
export function InspectionChecklist({ taskId, items, summary, canEdit, canAi }: { taskId: string; items: Item[]; summary: string | null; canEdit: boolean; canAi: boolean }) {
  const router = useRouter();
  const [state, setState] = React.useState(Object.fromEntries(items.map((i) => [i.id, { condition: i.condition, note: i.note ?? "" }])));
  const [busy, setBusy] = React.useState(false);
  const rooms = [...new Set(items.map((i) => i.room))];
  const rated = Object.values(state).filter((s) => s.condition).length;
  const save = async (id: string, patch: { condition?: string; note?: string }) => {
    setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
    const r = await saveInspectionItemAction(taskId, id, patch);
    if (!r.ok) toast.error(r.error);
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{rated} of {items.length} rated</Badge>
        <Button asChild variant="secondary" size="sm"><a href={`/app/tasks/${taskId}/report`} target="_blank" rel="noopener">Printable report (PDF)</a></Button>
        {canAi ? (
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await summarizeInspectionAction(taskId);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("AI summary ready");
            router.refresh();
          }}>
            <Sparkles aria-hidden /> AI summary
          </Button>
        ) : null}
      </div>
      {summary ? (
        <div className="rounded-card border border-primary/30 bg-primary-soft/40 p-4 text-sm" aria-live="polite">
          <div className="mb-1 flex items-center gap-1.5 font-semibold"><Sparkles className="size-4" aria-hidden /> AI summary</div>
          <p>{summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">Generated by AI — review before sharing.</p>
        </div>
      ) : null}
      {rooms.map((room) => (
        <section key={room} aria-labelledby={`room-${room}`} className="rounded-card border border-border bg-surface">
          <h3 id={`room-${room}`} className="border-b border-border px-4 py-2.5 text-sm font-semibold">{room}</h3>
          <ul className="divide-y divide-border">
            {items.filter((i) => i.room === room).map((i) => {
              const s = state[i.id]!;
              return (
                <li key={i.id} className="grid gap-2 px-4 py-3 md:grid-cols-[180px_1fr_1fr] md:items-center">
                  <span className="text-sm font-medium">{i.item}</span>
                  <fieldset className="flex flex-wrap gap-1" disabled={!canEdit}>
                    <legend className="sr-only">Condition of {i.item}</legend>
                    {CONDITIONS.map((c) => (
                      <label key={c.value} className={cn("cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring", s.condition === c.value ? (c.value === "DAMAGED" || c.value === "POOR" ? "border-danger bg-danger-soft text-danger-soft-foreground" : c.value === "FAIR" ? "border-warning bg-warning-soft text-warning-soft-foreground" : "border-primary bg-primary-soft text-primary-soft-foreground") : "border-border text-muted-foreground")}>
                        <input type="radio" className="sr-only" name={`cond-${i.id}`} value={c.value} checked={s.condition === c.value} onChange={() => save(i.id, { condition: c.value })} />
                        {s.condition === c.value ? "✓ " : ""}{c.label}
                      </label>
                    ))}
                  </fieldset>
                  <Input aria-label={`Note for ${i.item}`} placeholder="Note" disabled={!canEdit} value={s.note} onChange={(e) => setState((x) => ({ ...x, [i.id]: { ...x[i.id]!, note: e.target.value } }))} onBlur={(e) => e.target.value !== (i.note ?? "") && save(i.id, { note: e.target.value })} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function BillFromInvoice({ taskId, expenseAccounts, defaultAccountId, today, estimateCents }: { taskId: string; expenseAccounts: { id: string; label: string }[]; defaultAccountId: string; today: string; estimateCents: number | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ billNumber: "", billDate: today, dueDate: today, amount: estimateCents ? (estimateCents / 100).toFixed(2) : "", accountId: defaultAccountId });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Enter vendor invoice → bill</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="inv-desc">
          <DialogHeader>
            <DialogTitle>Convert vendor invoice to a bill</DialogTitle>
            <DialogDescription id="inv-desc">Posts Dr expense / Cr Accounts Payable, tagged to this property and unit. Pay it from Accounting → Bills.</DialogDescription>
          </DialogHeader>
          <form className="contents" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await billFromWorkOrder(taskId, v);
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            toast.success("Bill created from invoice");
            setOpen(false);
            router.refresh();
          }}>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Invoice #">{(a) => <Input {...a} value={v.billNumber} onChange={(e) => setV({ ...v, billNumber: e.target.value })} />}</Field>
              <Field label="Amount" error={errors.amount} required>{(a) => <Input {...a} inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
              <Field label="Invoice date">{(a) => <Input {...a} type="date" value={v.billDate} onChange={(e) => setV({ ...v, billDate: e.target.value })} />}</Field>
              <Field label="Due date" error={errors.dueDate}>{(a) => <Input {...a} type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />}</Field>
              <Field label="Expense account" className="sm:col-span-2">
                {(a) => (
                  <NativeSelect {...a} value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
                    {expenseAccounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Create bill</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
