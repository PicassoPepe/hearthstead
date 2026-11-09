"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { issueLicenseAction } from "@/server/actions/admin";

export function IssueLicenseForm({ plans, disabled }: { plans: { key: string; displayName: string }[]; disabled: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState({ customerEmail: "", customerName: "", planKey: plans[0]?.key ?? "local_annual", maxUnits: "25", months: "12" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <form className="grid gap-3 sm:grid-cols-5" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await issueLicenseAction({ customerEmail: v.customerEmail, customerName: v.customerName, planKey: v.planKey, maxUnits: Number(v.maxUnits), months: Number(v.months) });
        setBusy(false);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
        setToken(r.data.token);
        toast.success("License issued — send it to the customer");
        router.refresh();
      }}>
        <Field label="Customer email" required error={errors.customerEmail}>{(a) => <Input {...a} type="email" value={v.customerEmail} onChange={(e) => setV({ ...v, customerEmail: e.target.value })} />}</Field>
        <Field label="Customer name">{(a) => <Input {...a} value={v.customerName} onChange={(e) => setV({ ...v, customerName: e.target.value })} />}</Field>
        <Field label="Plan" error={errors.planKey}>{(a) => <NativeSelect {...a} value={v.planKey} onChange={(e) => setV({ ...v, planKey: e.target.value })}>{plans.map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}</NativeSelect>}</Field>
        <Field label="Units allowed" error={errors.maxUnits}>{(a) => <Input {...a} inputMode="numeric" value={v.maxUnits} onChange={(e) => setV({ ...v, maxUnits: e.target.value })} />}</Field>
        <Field label="Months">{(a) => <Input {...a} inputMode="numeric" value={v.months} onChange={(e) => setV({ ...v, months: e.target.value })} />}</Field>
        <div className="sm:col-span-5"><Button type="submit" loading={busy} disabled={disabled}>Issue license</Button></div>
      </form>
      {token ? (
        <Field label="License to send (they paste it in Settings → Billing)">{(a) => <Textarea {...a} readOnly rows={4} className="font-mono text-xs" value={token} onFocus={(e) => e.currentTarget.select()} />}</Field>
      ) : null}
    </div>
  );
}
