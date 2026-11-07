"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { sendLeaseForSignatureAction, voidSignatureAction } from "@/server/actions/funnel";

export function SendForSignature({ leaseId, templates }: { leaseId: string; templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [t, setT] = React.useState(templates[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  return (
    <span className="flex items-center gap-2">
      <NativeSelect aria-label="Template" className="w-56" value={t} onChange={(e) => setT(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
      <Button size="sm" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await sendLeaseForSignatureAction(leaseId, t || null);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.data.missing.length ? `Sent for e-signature — note: ${r.data.missing.join(", ")} left blank` : "Sent for e-signature");
        router.refresh();
      }}><PenLine aria-hidden /> Send for e-signature</Button>
    </span>
  );
}

export function VoidSignatureButton({ id }: { id: string }) {
  const router = useRouter();
  return <Button size="sm" variant="ghost" onClick={async () => { const r = await voidSignatureAction(id); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }}>Void</Button>;
}
