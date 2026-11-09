"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoneyInput } from "@/components/ui/money-input";
import { formatMoney } from "@/lib/money";
import { convenienceFee } from "@/lib/payments";
import { payNow } from "@/server/actions/portal";
import { AddMethodForm } from "./method-forms";
import { cn } from "@/lib/utils";

type Method = { id: string; type: "CARD" | "ACH"; label: string; detail: string; isDefault: boolean; verified: boolean };

export function PayForm({ balanceCents, methods, allowPartial, passThroughCard, passThroughAch, readOnly, stripeKey }: { balanceCents: number; methods: Method[]; allowPartial: boolean; passThroughCard: boolean; passThroughAch: boolean; readOnly: boolean; stripeKey?: string | null }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"FULL" | "OTHER">(balanceCents > 0 ? "FULL" : "OTHER");
  const [other, setOther] = React.useState<number | null>(null);
  const [methodId, setMethodId] = React.useState(methods.find((m) => m.isDefault && m.verified)?.id ?? methods.find((m) => m.verified)?.id ?? "");
  const [adding, setAdding] = React.useState(methods.length === 0);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ status: string; amount: number } | null>(null);
  const idem = React.useRef(crypto.randomUUID());
  const amount = mode === "FULL" ? Math.max(balanceCents, 0) : (other ?? 0);
  const method = methods.find((m) => m.id === methodId);
  const fee = method ? convenienceFee(method.type, amount, method.type === "CARD" ? passThroughCard : passThroughAch) : 0;
  const canOther = allowPartial || balanceCents <= 0;
  const tooLittle = !allowPartial && balanceCents > 0 && amount < balanceCents;

  if (done) {
    return (
      <Card className="p-6 text-center" role="status">
        {done.status === "PROCESSING" ? <Clock className="mx-auto size-10 text-info" aria-hidden /> : <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />}
        <h2 className="mt-3 text-xl font-semibold">{done.status === "PROCESSING" ? "Payment submitted" : "Payment successful"}</h2>
        <p className="mt-1 text-muted-foreground">
          {formatMoney(done.amount)} {done.status === "PROCESSING" ? "is on its way from your bank. It usually clears in 2–3 business days." : "has been applied to your balance."}
        </p>
        <Button asChild className="mt-5"><Link href="/portal/tenant">Back to home</Link></Button>
      </Card>
    );
  }

  const submit = async () => {
        if (!method) return void toast.error("Choose how you'd like to pay");
        if (amount <= 0) return void toast.error("Enter an amount");
        setBusy(true);
        const r = await payNow({ paymentMethodId: method.id, amountCents: amount, idempotencyKey: idem.current });
        setBusy(false);
        if (!r.ok) {
          idem.current = crypto.randomUUID();
          return void toast.error(r.error);
        }
        setDone({ status: r.data.status, amount });
        router.refresh();
  };

  // Not a <form>: the inline "add a method" form below can't be nested inside another form.
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-semibold">Amount</legend>
        {balanceCents > 0 ? (
          <label className={cn("flex items-center gap-3 rounded-lg border p-3", mode === "FULL" ? "border-primary ring-1 ring-primary" : "border-border")}>
            <input type="radio" name="amount" className="size-5 accent-[var(--primary)]" checked={mode === "FULL"} onChange={() => setMode("FULL")} />
            <span className="flex-1">Full balance</span>
            <span className="tabular font-semibold">{formatMoney(balanceCents)}</span>
          </label>
        ) : null}
        {canOther ? (
          <label className={cn("flex flex-wrap items-center gap-3 rounded-lg border p-3", mode === "OTHER" ? "border-primary ring-1 ring-primary" : "border-border")}>
            <input type="radio" name="amount" className="size-5 accent-[var(--primary)]" checked={mode === "OTHER"} onChange={() => setMode("OTHER")} />
            <span className="flex-1">{balanceCents > 0 ? "Other amount" : "Amount"}</span>
            <span className="w-36"><MoneyInput aria-label="Other amount" valueCents={other} onChangeCents={(c) => { setOther(c); setMode("OTHER"); }} /></span>
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">Your property requires paying the full balance.</p>
        )}
        {tooLittle && mode === "OTHER" ? <p role="alert" className="text-sm text-danger">Partial payments aren&apos;t allowed — pay the full balance.</p> : null}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 font-semibold">Pay with</legend>
        {methods.filter((m) => m.verified).map((m) => (
          <label key={m.id} className={cn("flex items-center gap-3 rounded-lg border p-3", methodId === m.id ? "border-primary ring-1 ring-primary" : "border-border")}>
            <input type="radio" name="method" className="size-5 accent-[var(--primary)]" checked={methodId === m.id} onChange={() => setMethodId(m.id)} />
            <span className="flex-1"><span className="font-medium">{m.label}</span><span className="block text-xs text-muted-foreground">{m.detail}</span></span>
            <span className="text-xs text-muted-foreground">{m.type === "CARD" ? (passThroughCard ? "Card fee applies" : "No fee") : passThroughAch ? "Small fee" : "No fee"}</span>
          </label>
        ))}
        {adding ? (
          <Card className="p-4"><AddMethodForm disabled={readOnly} stripeKey={stripeKey} onAdded={(id) => { setMethodId(id); setAdding(false); }} /></Card>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>Add a bank account or card</Button>
        )}
      </fieldset>

      {method && amount > 0 ? (
        <Card className="grid gap-1 p-4 text-sm" aria-live="polite">
          <div className="flex justify-between"><span>Payment</span><span className="tabular">{formatMoney(amount)}</span></div>
          <div className="flex justify-between"><span>{method.type === "CARD" ? "Card" : "Bank"} convenience fee</span><span className="tabular">{formatMoney(fee)}</span></div>
          <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total charged</span><span className="tabular">{formatMoney(amount + fee)}</span></div>
        </Card>
      ) : null}

      <Button type="button" size="lg" loading={busy} onClick={submit} disabled={readOnly || !method || amount <= 0 || (tooLittle && mode === "OTHER")}>
        {readOnly ? "Preview only" : `Pay ${formatMoney(amount + fee)}`}
      </Button>
    </div>
  );
}
