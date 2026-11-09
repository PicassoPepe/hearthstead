"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { portalRedeemCodeAction } from "@/server/actions/discounts";

/** Tenant portal: "Have a discount code?" */
export function DiscountCodeForm({ readOnly }: { readOnly?: boolean }) {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string>();
  return (
    <Card className="p-4">
      <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await portalRedeemCodeAction(code);
        setBusy(false);
        if (!r.ok) { setErr(r.fieldErrors?.code ?? r.error); return void toast.error(r.error); }
        setErr(undefined);
        setCode("");
        setDone(r.data.description);
        toast.success(r.message ?? "Code applied");
        router.refresh();
      }}>
        <Field label="Have a discount code?" error={err} className="min-w-48 flex-1">{(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" disabled={readOnly} />}</Field>
        <Button type="submit" variant="secondary" loading={busy} disabled={readOnly || !code.trim()}>Apply code</Button>
      </form>
      {done ? <p role="status" className="mt-2 text-sm text-success">Applied: {done}.</p> : null}
    </Card>
  );
}
