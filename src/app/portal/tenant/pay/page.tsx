import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { PayForm } from "@/components/portal/pay-form";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Pay rent" };

export default async function PayPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  if (!h) return <Card className="p-6">No active lease.</Card>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Make a payment</h1>
      {h.paymentsReady ? (
        <PayForm
          balanceCents={h.balanceCents}
          methods={h.methods}
          allowPartial={h.settings.allowPartialPayments}
          passThroughCard={h.settings.passThroughCard}
          passThroughAch={h.settings.passThroughAch}
          readOnly={ctx.preview}
        />
      ) : (
        <Card className="p-6 text-muted-foreground">Online payments aren&apos;t available for your lease. Contact {ctx.org.name} for other ways to pay.</Card>
      )}
    </div>
  );
}
