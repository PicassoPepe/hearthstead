"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { connectPayments } from "@/server/actions/payments";

export function ProcessorCard({ account, provider, canEdit, comingSoon = false }: { account: { status: string; externalId: string; payoutBankMask: string | null } | null; provider: string; canEdit: boolean; comingSoon?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>Online payments</CardTitle>
          <CardDescription>
            Accept card and ACH rent payments in the resident portal. {provider === "mock" ? "Running on the built-in mock processor — no Stripe keys needed." : "Powered by Stripe Connect (Express)."}
          </CardDescription>
        </div>
        <Landmark className="size-5 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        {comingSoon ? (
          <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground" data-testid="payments-coming-soon">Online payments are coming soon. Until then, record cash, check and money-order payments from <strong>Rent &amp; Money → Record a rent payment</strong>.</p>
        ) : account ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={account.status === "ACTIVE" ? "success" : "warning"}>{account.status === "ACTIVE" ? <><CheckCircle2 className="size-3" aria-hidden /> Accepting payments</> : account.status === "RESTRICTED" ? "Needs more information" : "Onboarding not finished"}</Badge>
            <span className="text-muted-foreground">Account {account.externalId}{account.payoutBankMask ? ` · payouts to ••${account.payoutBankMask}` : ""}</span>
            {canEdit && account.status !== "ACTIVE" ? <Button size="sm" loading={busy} onClick={go}>Continue onboarding</Button> : null}
          </div>
        ) : canEdit ? (
          <Button loading={busy} onClick={go}>Connect payments</Button>
        ) : (
          <p className="text-sm text-muted-foreground">Not connected. Ask an Admin to connect payments.</p>
        )}
      </CardContent>
    </Card>
  );

  async function go() {
    setBusy(true);
    const r = await connectPayments();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    if (r.data.onboardingUrl) window.location.href = r.data.onboardingUrl;
    else {
      toast.success("Payments connected — tenants can pay online");
      router.refresh();
    }
  }
}
