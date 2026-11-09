"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openBillingPortalAction, startCheckoutAction } from "@/server/actions/billing";

/** Goes to Stripe's secure checkout page for this plan. */
export function ChoosePlanButton({ planKey, interval, label, primary }: { planKey: string; interval: "month" | "year"; label: string; primary?: boolean }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant={primary ? "primary" : "secondary"} loading={busy} onClick={async () => {
      setBusy(true);
      const r = await startCheckoutAction({ planKey, interval });
      if (!r.ok) { setBusy(false); return void toast.error(r.error); }
      window.location.assign(r.data.url);
    }}>{label}</Button>
  );
}

/** Stripe's customer portal: change card, see receipts, change or cancel the plan. */
export function ManageBillingButton() {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await openBillingPortalAction();
      if (!r.ok) { setBusy(false); return void toast.error(r.error); }
      window.location.assign(r.data.url);
    }}>Manage card & receipts</Button>
  );
}
