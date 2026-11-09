"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/server/action-result";
import { approveDiscountAction, rejectDiscountAction, revokeDiscountAction, saveDiscountPolicyAction } from "@/server/actions/discounts";

function ReasonButton({ label, title, description, danger, run }: { label: string; title: string; description: string; danger?: boolean; run: (reason: string) => Promise<ActionResult<unknown>> }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();
  return (
    <>
      <Button size="sm" variant={danger ? "danger" : "secondary"} onClick={() => { setReason(""); setErr(undefined); setOpen(true); }}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="reason-desc">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription id="reason-desc">{description}</DialogDescription></DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await run(reason);
            setBusy(false);
            if (!r.ok) { setErr(r.fieldErrors?.reason); return void toast.error(r.error); }
            toast.success(r.message ?? "Done");
            setOpen(false);
            router.refresh();
          }}>
            <DialogBody><Field label="Reason" required error={err}>{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field></DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{label}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DiscountActions({ id, status, canApprove, isCreator }: { id: string; status: string; canApprove: boolean; isCreator: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (!canApprove) return null;
  if (status === "PENDING_APPROVAL") {
    return (
      <div className="flex flex-wrap gap-2">
        {isCreator ? <p className="text-sm text-muted-foreground">Someone else with Full access has to approve this.</p> : (
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await approveDiscountAction(id);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message ?? "Approved");
            router.refresh();
          }}>Approve</Button>
        )}
        <ReasonButton label="Turn down" title="Turn down this discount" description="Nothing is taken off. The request stays in the history." run={(r) => rejectDiscountAction(id, r)} />
      </div>
    );
  }
  if (status === "ACTIVE") return <ReasonButton label="Stop this discount" danger title="Stop this discount" description="It won't come off any new charges. Discounts already given stay on the books." run={(r) => revokeDiscountAction(id, r)} />;
  return null;
}

/** Owner settings: the reasons list and when a second person must approve. */
export function DiscountPolicyForm({ reasons, overCents, overPercentBps }: { reasons: string[]; overCents: number; overPercentBps: number }) {
  const router = useRouter();
  const [text, setText] = React.useState(reasons.join("\n"));
  const [cents, setCents] = React.useState<number | null>(overCents);
  const [pct, setPct] = React.useState(String(overPercentBps / 100));
  const [busy, setBusy] = React.useState(false);
  return (
    <form className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await saveDiscountPolicyAction({ reasons: text.split("\n"), overCents: cents ?? 0, overPercentBps: Math.round(Number(pct || 0) * 100) });
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      router.refresh();
    }}>
      <Field label="Reasons to choose from" description="One per line. “Other (specify)” is always offered too.">{(a) => <Textarea {...a} rows={8} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dollar discounts above this need approval" description="$0 = never.">{(a) => <MoneyInput {...a} valueCents={cents} onChangeCents={setCents} />}</Field>
        <Field label="Percent discounts above this need approval" description="0 = never.">{(a) => <Input {...a} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
      </div>
      <div><Button type="submit" size="sm" loading={busy}>Save</Button></div>
    </form>
  );
}
