"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { saveAutopay, stopAutopay } from "@/server/actions/portal";
import { formatMoney } from "@/lib/money";

type Props = {
  methods: { id: string; label: string; verified: boolean }[];
  current: { dayOfMonth: number; amountMode: string; fixedCents: number | null; paymentMethodId: string } | null;
  rentCents: number;
  rentDueDay: number;
  readOnly: boolean;
};

export function AutopayForm({ methods, current, rentCents, rentDueDay, readOnly }: Props) {
  const router = useRouter();
  const [methodId, setMethodId] = React.useState(current?.paymentMethodId ?? methods.find((m) => m.verified)?.id ?? "");
  const [day, setDay] = React.useState(current?.dayOfMonth ?? rentDueDay);
  const [mode, setMode] = React.useState(current?.amountMode ?? "FULL_BALANCE");
  const [fixed, setFixed] = React.useState(current?.fixedCents ? (current.fixedCents / 100).toFixed(2) : (rentCents / 100).toFixed(2));
  const [busy, setBusy] = React.useState(false);
  const [confirmStop, setConfirmStop] = React.useState(false);
  const verified = methods.filter((m) => m.verified);

  if (!verified.length) {
    return <Card className="p-5 text-sm">Add a bank account or card first. <Link href="/portal/tenant/methods" className="font-medium text-primary underline">Add a payment method</Link></Card>;
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await saveAutopay({ paymentMethodId: methodId, dayOfMonth: day, amountMode: mode as "FULL_BALANCE" | "FIXED", fixedAmount: fixed });
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Autopay is on");
        router.refresh();
      }}
    >
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Pay from" className="sm:col-span-2">
          {(a) => (
            <NativeSelect {...a} value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {verified.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label="Day of the month" description={`Rent is due on day ${rentDueDay}.`}>
          {(a) => (
            <NativeSelect {...a} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </NativeSelect>
          )}
        </Field>
        <fieldset className="grid gap-1.5 text-sm">
          <legend className="mb-1 text-[13px] font-medium">Amount</legend>
          <label className="flex items-center gap-2"><input type="radio" name="mode" className="size-4 accent-[var(--primary)]" checked={mode === "FULL_BALANCE"} onChange={() => setMode("FULL_BALANCE")} /> Full balance each month</label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" className="size-4 accent-[var(--primary)]" checked={mode === "FIXED"} onChange={() => setMode("FIXED")} /> A fixed amount</label>
        </fieldset>
        {mode === "FIXED" ? (
          <Field label="Fixed amount" className="sm:col-span-2">{(a) => <Input {...a} inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} />}</Field>
        ) : null}
      </Card>
      <p className="rounded-lg bg-info-soft p-3 text-sm text-info-soft-foreground" aria-live="polite">
        Schedule: on day {day} of every month we&apos;ll charge {mode === "FIXED" ? `$${fixed}` : `your full balance (usually ${formatMoney(rentCents)})`} to {methods.find((m) => m.id === methodId)?.label}. If nothing is due, nothing is charged.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" loading={busy} disabled={readOnly}>{current ? "Update autopay" : "Turn on autopay"}</Button>
        {current ? <Button type="button" variant="secondary" size="lg" disabled={readOnly} onClick={() => setConfirmStop(true)}>Turn off</Button> : null}
      </div>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Turn off autopay?"
        description="You'll need to pay each month yourself."
        confirmLabel="Turn off autopay"
        destructive
        onConfirm={async () => {
          const r = await stopAutopay();
          setConfirmStop(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Autopay turned off");
          router.refresh();
        }}
      />
    </form>
  );
}
