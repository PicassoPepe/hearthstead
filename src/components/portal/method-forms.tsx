"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, CreditCard } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addBank, addCard } from "@/server/actions/portal";

/**
 * Add a card or bank account. In mock mode details go to our server and only last-4 is kept;
 * with Stripe, Elements/Financial Connections tokenize on the client instead (see README).
 */
export function AddMethodForm({ onAdded, disabled }: { onAdded?: (id: string) => void; disabled?: boolean }) {
  const router = useRouter();
  const [card, setCard] = React.useState({ number: "", exp: "", cvc: "" });
  const [bank, setBank] = React.useState({ holderName: "", routingNumber: "", accountNumber: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const done = (id: string, msg: string) => {
    toast.success(msg);
    setErrors({});
    onAdded?.(id);
    router.refresh();
  };

  return (
    <Tabs defaultValue="ACH">
      <TabsList className="mb-4" aria-label="Payment method type">
        <TabsTrigger value="ACH"><Building2 className="mr-1.5 inline size-4" aria-hidden />Bank account</TabsTrigger>
        <TabsTrigger value="CARD"><CreditCard className="mr-1.5 inline size-4" aria-hidden />Card</TabsTrigger>
      </TabsList>
      <TabsContent value="ACH">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await addBank(bank);
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            done(r.data.id, "Bank account verified");
          }}
        >
          <Field label="Account holder name" error={errors.holderName} required className="sm:col-span-2">{(a) => <Input {...a} autoComplete="name" value={bank.holderName} onChange={(e) => setBank({ ...bank, holderName: e.target.value })} />}</Field>
          <Field label="Routing number" error={errors.routingNumber} required>{(a) => <Input {...a} inputMode="numeric" autoComplete="off" value={bank.routingNumber} onChange={(e) => setBank({ ...bank, routingNumber: e.target.value })} />}</Field>
          <Field label="Account number" error={errors.accountNumber} required>{(a) => <Input {...a} inputMode="numeric" autoComplete="off" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} />}</Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">Bank payments usually have no fee and take 2–3 business days to clear.</p>
          <div className="sm:col-span-2"><Button type="submit" loading={busy} disabled={disabled}>Verify &amp; save bank account</Button></div>
        </form>
      </TabsContent>
      <TabsContent value="CARD">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await addCard(card);
            setBusy(false);
            if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
            done(r.data.id, "Card saved");
          }}
        >
          <Field label="Card number" error={errors.number} required className="sm:col-span-3">{(a) => <Input {...a} inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} />}</Field>
          <Field label="Expiry (MM/YY)" error={errors.exp} required>{(a) => <Input {...a} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} />}</Field>
          <Field label="Security code" error={errors.cvc} required>{(a) => <Input {...a} inputMode="numeric" autoComplete="cc-csc" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} />}</Field>
          <div className="self-end"><Button type="submit" loading={busy} disabled={disabled}>Save card</Button></div>
        </form>
      </TabsContent>
    </Tabs>
  );
}
