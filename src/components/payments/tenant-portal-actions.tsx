"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Lock, LockOpen, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inviteToPortal, pauseTenantPortalAction, previewPortalAs, resumeTenantPortalAction } from "@/server/actions/payments";

export function TenantPortalActions({ tenantId, status, hasEmail, canInvite, paused = false, name = "this tenant" }: { tenantId: string; status: string; hasEmail: boolean; canInvite: boolean; paused?: boolean; name?: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  return (
    <>
      {canInvite && status !== "NOT_INVITED" ? <PauseAccess tenantId={tenantId} paused={paused} name={name} /> : null}
      {canInvite && !paused ? (
        <Button
          variant="secondary"
          loading={busy}
          disabled={!hasEmail}
          title={hasEmail ? undefined : "Add an email address first"}
          onClick={async () => {
            setBusy(true);
            const r = await inviteToPortal([tenantId]);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Portal invitation sent");
            router.refresh();
          }}
        >
          <Mail aria-hidden /> {status === "NOT_INVITED" ? "Invite to portal" : "Re-send invite"}
        </Button>
      ) : null}
      <Button variant="secondary" loading={previewing} onClick={() => { setPreviewing(true); void previewPortalAs(tenantId); }}>
        <Eye aria-hidden /> Preview portal as
      </Button>
    </>
  );
}

/** Pause / turn back on a tenant's portal sign-in. Their records always stay. */
function PauseAccess({ tenantId, paused, name }: { tenantId: string; paused: boolean; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [stopAutopay, setStopAutopay] = React.useState(false);
  const [error, setError] = React.useState<string>();
  if (paused) {
    return (
      <Button variant="secondary" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await resumeTenantPortalAction(tenantId);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Portal access turned back on");
        router.refresh();
      }}><LockOpen aria-hidden /> Turn portal access back on</Button>
    );
  }
  return (
    <>
      <Button variant="secondary" onClick={() => { setReason(""); setStopAutopay(false); setError(undefined); setOpen(true); }}><Lock aria-hidden /> Pause portal access</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="pause-desc">
          <DialogHeader>
            <DialogTitle>Pause portal access for {name}?</DialogTitle>
            <DialogDescription id="pause-desc">They won&apos;t be able to sign in to the resident portal. Everything is kept — lease, payments, balance, messages, repair requests and files — and you can turn access back on any time.</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await pauseTenantPortalAction(tenantId, reason, stopAutopay);
            setBusy(false);
            if (!r.ok) { setError(r.fieldErrors?.reason ? r.error : undefined); return void toast.error(r.error); }
            toast.success(r.data.autopaysStopped ? "Portal access paused and automatic payments stopped" : "Portal access paused — all their information is kept");
            setOpen(false);
            router.refresh();
          }}>
            <DialogBody className="grid gap-3">
              <Field label="Reason (only you see this)" required error={error}>{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: moved out, eviction, account under review" />}</Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={stopAutopay} onChange={(e) => setStopAutopay(e.target.checked)} /> <span>Also stop their automatic payments <span className="block text-muted-foreground">Leave this off if they should keep paying rent automatically.</span></span></label>
            </DialogBody>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Pause access</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
