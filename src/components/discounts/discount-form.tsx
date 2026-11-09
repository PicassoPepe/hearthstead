"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DISCOUNTABLE_KINDS, OTHER_REASON } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { createDiscountAction, leaseChargesForDiscountAction } from "@/server/actions/discounts";

type Opt = { id: string; label: string };

/** "Give a discount": to one lease (a direct concession) or as a code tenants enter. */
export function GiveDiscountButton({ leases, properties, reasons, defaultLeaseId, today, label = "Give a discount" }: { leases: Opt[]; properties: Opt[]; reasons: string[]; defaultLeaseId?: string; today: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(Boolean(defaultLeaseId));
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [delivery, setDelivery] = React.useState<"DIRECT" | "CODE">("DIRECT");
  const [leaseId, setLeaseId] = React.useState(defaultLeaseId ?? "");
  const [target, setTarget] = React.useState<"CHARGE_KINDS" | "SINGLE_CHARGE">("CHARGE_KINDS");
  const [charges, setCharges] = React.useState<{ id: string; label: string; amountCents: number }[]>([]);
  const [chargeId, setChargeId] = React.useState("");
  const [kinds, setKinds] = React.useState<string[]>(["RENT"]);
  const [kind, setKind] = React.useState<"PERCENT" | "FIXED">("FIXED");
  const [percent, setPercent] = React.useState("");
  const [cents, setCents] = React.useState<number | null>(null);
  const [duration, setDuration] = React.useState<"ONCE" | "MONTHS" | "DATE_RANGE" | "FOREVER">("ONCE");
  const [months, setMonths] = React.useState("3");
  const [startDate, setStartDate] = React.useState(today.slice(0, 8) + "01");
  const [endDate, setEndDate] = React.useState("");
  const [code, setCode] = React.useState("");
  const [codeExpires, setCodeExpires] = React.useState("");
  const [maxUses, setMaxUses] = React.useState("");
  const [perTenant, setPerTenant] = React.useState("1");
  const [propertyId, setPropertyId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [reasonOther, setReasonOther] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (target !== "SINGLE_CHARGE" || !leaseId) return;
    let live = true;
    leaseChargesForDiscountAction(leaseId).then((r) => { if (live && r.ok) setCharges(r.data); });
    return () => { live = false; };
  }, [target, leaseId]);

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await createDiscountAction({
      kind, value: kind === "PERCENT" ? Math.round(Number(percent || 0) * 100) : cents ?? 0,
      target: delivery === "CODE" ? "CHARGE_KINDS" : target, chargeId: chargeId || undefined, chargeKinds: kinds,
      duration, months: num(months), startDate, endDate,
      delivery, leaseId: delivery === "DIRECT" ? leaseId || undefined : undefined,
      code: delivery === "CODE" ? code : undefined, codeExpiresAt: codeExpires, maxUses: num(maxUses), perTenantLimit: num(perTenant), propertyId: delivery === "CODE" ? propertyId || undefined : undefined,
      reason, reasonOther, notes,
    });
    setBusy(false);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
    toast.success(r.data.pending ? "Sent for approval — it starts once someone with Full access approves it" : r.data.appliedCents ? `Discount given — ${formatMoney(r.data.appliedCents)} taken off so far` : "Discount saved — it comes off matching charges automatically");
    setOpen(false);
    router.push(`/app/money/discounts/${r.data.id}`);
  };

  return (
    <>
      <Button onClick={() => { setErrors({}); setOpen(true); }}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" aria-describedby="give-discount-desc">
          <DialogHeader>
            <DialogTitle>Give a discount</DialogTitle>
            <DialogDescription id="give-discount-desc">It shows on the tenant&apos;s account with the reason, and is recorded in the discount history.</DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={submit}>
            <DialogBody className="grid gap-4">
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-medium">Who gets it?</legend>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="delivery" checked={delivery === "DIRECT"} onChange={() => setDelivery("DIRECT")} /> A tenant&apos;s lease (I&apos;ll apply it now)</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="delivery" checked={delivery === "CODE"} onChange={() => { setDelivery("CODE"); setTarget("CHARGE_KINDS"); }} /> A code tenants enter in their portal</label>
              </fieldset>

              {delivery === "DIRECT" ? (
                <Field label="Lease" required error={errors.leaseId}>{(a) => (
                  <NativeSelect {...a} value={leaseId} onChange={(e) => { setLeaseId(e.target.value); setChargeId(""); }}>
                    <option value="">Choose a lease…</option>
                    {leases.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </NativeSelect>
                )}</Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Code" required error={errors.code} description="Letters, numbers, dashes.">{(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SPRING-50" />}</Field>
                  <Field label="Only for this property" error={errors.propertyId}>{(a) => (
                    <NativeSelect {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                      <option value="">Any property</option>
                      {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </NativeSelect>
                  )}</Field>
                  <Field label="Code stops working on" error={errors.codeExpiresAt}>{(a) => <Input {...a} type="date" value={codeExpires} onChange={(e) => setCodeExpires(e.target.value)} />}</Field>
                  <Field label="How many leases can use it" error={errors.maxUses} description="Empty = no limit.">{(a) => <Input {...a} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />}</Field>
                  <Field label="Uses per tenant" error={errors.perTenantLimit}>{(a) => <Input {...a} inputMode="numeric" value={perTenant} onChange={(e) => setPerTenant(e.target.value)} />}</Field>
                </div>
              )}

              {delivery === "DIRECT" ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-[13px] font-medium">What does it come off?</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="target" checked={target === "CHARGE_KINDS"} onChange={() => setTarget("CHARGE_KINDS")} /> Kinds of charges (rent, fees…)</label>
                  <label className="flex items-center gap-2 text-sm"><input type="radio" name="target" checked={target === "SINGLE_CHARGE"} onChange={() => setTarget("SINGLE_CHARGE")} /> One charge that&apos;s already on the account</label>
                </fieldset>
              ) : null}

              {target === "SINGLE_CHARGE" && delivery === "DIRECT" ? (
                <Field label="Charge" required error={errors.chargeId}>{(a) => (
                  <NativeSelect {...a} value={chargeId} onChange={(e) => setChargeId(e.target.value)}>
                    <option value="">{leaseId ? "Choose a charge…" : "Choose a lease first"}</option>
                    {charges.map((c) => <option key={c.id} value={c.id}>{c.label} — {formatMoney(c.amountCents)}</option>)}
                  </NativeSelect>
                )}</Field>
              ) : (
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1 text-[13px] font-medium">Which charges?</legend>
                  {Object.entries(DISCOUNTABLE_KINDS).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} /> {l}</label>
                  ))}
                  <p className="text-xs text-muted-foreground">None checked = every charge. Security deposits are never discounted.</p>
                </fieldset>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type">{(a) => (
                  <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value as "PERCENT" | "FIXED")}>
                    <option value="FIXED">Dollar amount off</option><option value="PERCENT">Percent off</option>
                  </NativeSelect>
                )}</Field>
                {kind === "PERCENT"
                  ? <Field label="Percent off" required error={errors.value}>{(a) => <Input {...a} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="10" />}</Field>
                  : <Field label="Amount off each charge" required error={errors.value}>{(a) => <MoneyInput {...a} valueCents={cents} onChangeCents={setCents} />}</Field>}
              </div>

              {target === "CHARGE_KINDS" || delivery === "CODE" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="How long?">{(a) => (
                    <NativeSelect {...a} value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
                      <option value="ONCE">Just the next matching charge</option>
                      <option value="MONTHS">For a number of months</option>
                      <option value="DATE_RANGE">Between two dates</option>
                      <option value="FOREVER">Until I stop it</option>
                    </NativeSelect>
                  )}</Field>
                  <Field label="Starting" required error={errors.startDate} description="Charges on or after this day.">{(a) => <Input {...a} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
                  {duration === "MONTHS" ? <Field label="Months" required error={errors.months}>{(a) => <Input {...a} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />}</Field> : null}
                  {duration === "DATE_RANGE" ? <Field label="Ending" required error={errors.endDate}>{(a) => <Input {...a} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field> : null}
                </div>
              ) : null}

              <Field label="Reason" required error={errors.reason}>{(a) => (
                <NativeSelect {...a} value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Choose a reason…</option>
                  {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value={OTHER_REASON}>{OTHER_REASON}</option>
                </NativeSelect>
              )}</Field>
              {reason === OTHER_REASON ? <Field label="Describe the reason" required error={errors.reasonOther}>{(a) => <Input {...a} value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} />}</Field> : null}
              <Field label="Notes (only staff see these)">{(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Give discount</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
