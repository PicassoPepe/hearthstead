"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/server/action-result";

/**
 * A button that asks "why?" (always) and, for risky actions, the current two-factor code,
 * then runs a bound server action. Every reason lands in the platform audit log.
 */
export function AdminAction<T>({ label, title, description, action, needsCode = false, needsReason = true, danger = false, after, children }: {
  label: string;
  title?: string;
  description?: string;
  action: (reason: string, code: string) => Promise<ActionResult<T>>;
  needsCode?: boolean;
  needsReason?: boolean;
  danger?: boolean;
  after?: (data: T) => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [code, setCode] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const id = React.useId();
  return (
    <>
      <Button size="sm" variant={danger ? "danger" : "secondary"} onClick={() => { setReason(""); setCode(""); setErrors({}); setOpen(true); }}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={`${id}-d`}>
          <DialogHeader>
            <DialogTitle>{title ?? label}</DialogTitle>
            <DialogDescription id={`${id}-d`}>{description ?? "This is recorded in the owner-console audit log."}</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await action(reason, code);
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            toast.success(r.message ?? "Done");
            setOpen(false);
            if (after) after(r.data);
            else router.refresh();
          }}>
            <DialogBody className="grid gap-3">
              {children}
              {needsReason ? <Field label="Reason" required error={errors.reason} description="Why are you doing this? (at least 5 characters)">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field> : null}
              {needsCode ? <Field label="Two-factor code" required error={errors.code} description="The current 6-digit code from your authenticator app.">{(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" className="w-40" value={code} onChange={(e) => setCode(e.target.value)} />}</Field> : null}
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{label}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
