"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/leasing";
import { postLeaseMoney, type MoneyInput as MoneyPayload } from "@/server/actions/leasing";
import { useCreateModal } from "@/components/create/create-modal";

export type MoneyKind = MoneyPayload["kind"];
export type MoneyOptions = {
  today: string;
  incomeAccounts: { id: string; label: string; systemKey: string | null }[];
  creditAccounts: { id: string; label: string }[];
  bankAccounts: { id: string; label: string }[];
  leases?: { id: string; label: string; balanceCents: number }[];
};

const TITLES: Record<MoneyKind, string> = {
  CHARGE: "Post charge", PAYMENT: "Receive payment", CREDIT: "Post credit", DEPOSIT: "Record deposit received",
  REFUND_DEPOSIT: "Refund deposit", REFUND_PREPAID: "Refund credit balance",
};

export function MoneyForm({ kind, leaseId: fixedLease, balanceCents, options, onDone }: { kind: MoneyKind; leaseId?: string; balanceCents?: number; options: MoneyOptions; onDone?: () => void }) {
  const router = useRouter();
  const modal = useCreateModal();
  const [leaseId, setLeaseId] = React.useState(fixedLease ?? "");
  const lease = options.leases?.find((l) => l.id === leaseId);
  const owed = balanceCents ?? lease?.balanceCents ?? 0;
  const defaultAmount = kind === "PAYMENT" && owed > 0 ? owed : kind === "REFUND_PREPAID" && owed < 0 ? -owed : null;
  const [amount, setAmount] = React.useState<number | null>(defaultAmount);
  const [date, setDate] = React.useState(options.today);
  const [accountId, setAccountId] = React.useState(kind === "CREDIT" ? (options.creditAccounts[0]?.id ?? "") : (options.incomeAccounts.find((a) => a.systemKey === "OTHER_INCOME")?.id ?? options.incomeAccounts[0]?.id ?? ""));
  const [depositAccountId, setDepositAccountId] = React.useState("");
  const [method, setMethod] = React.useState("CHECK");
  const [reference, setReference] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (kind === "PAYMENT" && lease) setAmount(lease.balanceCents > 0 ? lease.balanceCents : null);
  }, [kind, lease]);

  const needsAccount = kind === "CHARGE" || kind === "CREDIT";
  const isPaymentLike = kind === "PAYMENT" || kind === "DEPOSIT";

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!leaseId) errs.leaseId = "Choose a lease";
        if (!amount || amount <= 0) errs.amountCents = "Enter an amount";
        if (needsAccount && !accountId) errs.accountId = "Choose an account";
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setBusy(true);
        const r = await postLeaseMoney({ kind, leaseId, amountCents: amount!, date, accountId: needsAccount ? accountId : undefined, depositAccountId: depositAccountId || undefined, method, reference, memo });
        setBusy(false);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          return void toast.error(r.error);
        }
        toast.success(`${r.message ?? "Saved"} — ${formatMoney(amount!)}`);
        if (onDone) onDone();
        else if (modal) {
          modal.close();
        } else router.push(`/app/leasing/${leaseId}?tab=transactions`);
        router.refresh();
      }}
    >
      {!fixedLease && options.leases ? (
        <Field label="Lease" error={errors.leaseId} required className="sm:col-span-2">
          {(a) => (
            <NativeSelect {...a} value={leaseId} onChange={(e) => setLeaseId(e.target.value)}>
              <option value="">Choose a lease</option>
              {options.leases!.map((l) => <option key={l.id} value={l.id}>{l.label} · balance {formatMoney(l.balanceCents)}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Amount" error={errors.amountCents} required description={kind === "PAYMENT" && leaseId ? `Balance due: ${formatMoney(owed)}. Anything extra becomes a credit balance.` : undefined}>
        {(a) => <MoneyInput {...a} valueCents={amount} onChangeCents={setAmount} />}
      </Field>
      <Field label="Date" error={errors.date} required>
        {(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      {needsAccount ? (
        <Field label={kind === "CHARGE" ? "Income account" : "Credit against"} error={errors.accountId} required className="sm:col-span-2">
          {(a) => (
            <NativeSelect {...a} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {(kind === "CHARGE" ? options.incomeAccounts : options.creditAccounts).map((acc) => <option key={acc.id} value={acc.id}>{acc.label}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      {isPaymentLike ? (
        <>
          <Field label="Method">
            {(a) => (
              <NativeSelect {...a} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Reference" description="Check number or confirmation">
            {(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
        </>
      ) : null}
      {kind === "PAYMENT" || kind === "REFUND_PREPAID" ? (
        <Field label={kind === "PAYMENT" ? "Deposit to" : "Pay from"} description={kind === "PAYMENT" ? "Undeposited Funds until you make a bank deposit." : undefined} className="sm:col-span-2">
          {(a) => (
            <NativeSelect {...a} value={depositAccountId} onChange={(e) => setDepositAccountId(e.target.value)}>
              <option value="">{kind === "PAYMENT" ? "Undeposited Funds" : "Operating Cash"}</option>
              {options.bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </NativeSelect>
          )}
        </Field>
      ) : null}
      <Field label="Memo" className="sm:col-span-2">
        {(a) => <Input {...a} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={kind === "CHARGE" ? "e.g. Pet fee" : undefined} />}
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onDone || modal ? <Button type="button" variant="secondary" onClick={() => (onDone ? onDone() : modal?.close())}>Cancel</Button> : null}
        <Button type="submit" loading={busy}>{TITLES[kind]}</Button>
      </div>
    </form>
  );
}

export { TITLES as MONEY_TITLES };
