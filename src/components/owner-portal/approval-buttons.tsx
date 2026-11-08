"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { decideOwnerApproval } from "@/server/actions/owner-portal";

export function OwnerApprovalButtons({ id }: { id: string }) {
  const router = useRouter();
  const [declining, setDeclining] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const decide = async (d: "APPROVED" | "DECLINED") => {
    setBusy(d);
    const r = await decideOwnerApproval(id, d, note);
    setBusy("");
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message);
    router.refresh();
  };
  return (
    <div className="mt-3 grid gap-2">
      {declining ? <Field label="Why are you declining?">{(a) => <Textarea {...a} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field> : null}
      <div className="flex flex-wrap gap-2">
        {!declining ? <Button loading={busy === "APPROVED"} onClick={() => decide("APPROVED")}>Approve</Button> : null}
        {declining ? <Button variant="danger" loading={busy === "DECLINED"} onClick={() => decide("DECLINED")}>Decline</Button> : <Button variant="secondary" onClick={() => setDeclining(true)}>Decline…</Button>}
        {declining ? <Button variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button> : null}
      </div>
    </div>
  );
}
