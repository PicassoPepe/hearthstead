"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approveApplicationAction, declineApplicationAction } from "@/server/actions/funnel";

export function ApplicationActions({ id, status, leaseId, suggestedReasons }: { id: string; status: string; leaseId: string | null; suggestedReasons: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reasons, setReasons] = React.useState(suggestedReasons);
  const [busy, setBusy] = React.useState("");
  if (status === "APPROVED") {
    return leaseId
      ? <Button asChild variant="secondary"><Link href={`/app/leasing/${leaseId}`}>Open lease</Link></Button>
      : <Button asChild><Link href={`/app/new/lease?applicationId=${id}`} scroll={false}>Create lease from application</Link></Button>;
  }
  if (!["SUBMITTED", "SCREENING"].includes(status)) return null;
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={() => setOpen(true)}>Decline…</Button>
      <Button loading={busy === "approve"} onClick={async () => {
        setBusy("approve");
        const r = await approveApplicationAction(id);
        setBusy("");
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message);
        router.refresh();
      }}>Approve</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog">
          <DialogHeader><DialogTitle>Decline application</DialogTitle><DialogDescription>The applicant receives an adverse action notice with these reasons and their rights under the Fair Credit Reporting Act.</DialogDescription></DialogHeader>
          <DialogBody><Field label="Reason(s)" required>{(a) => <Textarea {...a} rows={3} value={reasons} onChange={(e) => setReasons(e.target.value)} />}</Field></DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={busy === "decline"} onClick={async () => {
              setBusy("decline");
              const r = await declineApplicationAction(id, reasons);
              setBusy("");
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
              router.refresh();
            }}>Decline &amp; send notice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
