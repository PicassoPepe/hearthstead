"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, CreditCard } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addBank, addCard, finishMethodSetup, startMethodSetup } from "@/server/actions/portal";
import { loadStripe, STRIPE_APPEARANCE, type StripeElements, type StripeJs } from "@/lib/stripe-js";

/**
 * Add a card or bank account.
 * - Real payments (`stripeKey` set): Stripe's secure Payment Element. Cards are typed and banks are
 *   linked by signing in to the bank (Financial Connections) inside Stripe's fields; DeedWood only
 *   ever receives the brand/bank name and last 4.
 * - Test mode (the built-in "mock" processor): simple fields; only last 4 is kept.
 */
export function AddMethodForm({ onAdded, disabled, stripeKey }: { onAdded?: (id: string) => void; disabled?: boolean; stripeKey?: string | null }) {
  if (stripeKey) return <SecureMethodForm stripeKey={stripeKey} onAdded={onAdded} disabled={disabled} />;
  return <TestMethodForm onAdded={onAdded} disabled={disabled} />;
}

function SecureMethodForm({ stripeKey, onAdded, disabled }: { stripeKey: string; onAdded?: (id: string) => void; disabled?: boolean }) {
  const router = useRouter();
  const box = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const stripe = React.useRef<{ js: StripeJs; elements: StripeElements } | null>(null);

  const finish = React.useCallback(async (setupIntentId: string) => {
    const r = await finishMethodSetup(setupIntentId);
    if (!r.ok) { setError(r.error); return void toast.error(r.error); }
    toast.success("Saved");
    onAdded?.(r.data.id);
    router.refresh();
  }, [onAdded, router]);

  React.useEffect(() => {
    if (disabled) return;
    let live = true;
    let mounted: { destroy(): void } | null = null;
    (async () => {
      // Back from a bank's sign-in page that used a full redirect: finish saving.
      const back = new URL(window.location.href).searchParams.get("setup_intent");
      if (back) {
        window.history.replaceState(null, "", window.location.pathname);
        await finish(back);
      }
      const r = await startMethodSetup();
      if (!live) return;
      if (!r.ok) { setError(r.error); return setState("error"); }
      try {
        const js = await loadStripe(stripeKey);
        if (!live || !box.current) return;
        const elements = js.elements({ clientSecret: r.data.clientSecret, appearance: STRIPE_APPEARANCE });
        const pe = elements.create("payment", { layout: "tabs" });
        pe.mount(box.current);
        mounted = pe;
        stripe.current = { js, elements };
        setState("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load the secure form.");
        setState("error");
      }
    })();
    return () => { live = false; mounted?.destroy(); };
  }, [stripeKey, disabled, finish]);

  return (
    <form className="grid gap-3" data-testid="secure-method-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!stripe.current) return;
      setBusy(true);
      setError(undefined);
      const { js, elements } = stripe.current;
      const r = await js.confirmSetup({ elements, redirect: "if_required", confirmParams: { return_url: window.location.href } });
      if (r.error || !r.setupIntent) { setBusy(false); setError(r.error?.message ?? "That didn't work. Please try again."); return; }
      await finish(r.setupIntent.id);
      setBusy(false);
    }}>
      <div ref={box} className="min-h-24" />
      {state === "loading" ? <p className="text-sm text-muted-foreground">Loading the secure form…</p> : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Card and bank details go straight to Stripe, our payment processor — we never see or store them. Bank payments usually have no fee and take 2–3 business days to clear.</p>
      <div><Button type="submit" loading={busy} disabled={disabled || state !== "ready"}>Save</Button></div>
    </form>
  );
}

function TestMethodForm({ onAdded, disabled }: { onAdded?: (id: string) => void; disabled?: boolean }) {
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
