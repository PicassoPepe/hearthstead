import { requirePortal } from "@/server/portal/context";
import { PAYMENTS_COMING_SOON } from "@/lib/payments-flag";
import { portalHome } from "@/server/portal/queries";
import { Card } from "@/components/ui/card";
import { MethodsList } from "@/components/portal/methods-list";
import { AddMethodForm } from "@/components/portal/method-forms";

export const metadata = { title: "Payment methods" };

export default async function MethodsPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  if (h?.paymentsComingSoon) return <div className="grid gap-4"><h1 className="text-2xl font-semibold tracking-tight">Payment methods</h1><Card className="p-6 text-muted-foreground" data-testid="payments-coming-soon">{PAYMENTS_COMING_SOON}</Card></div>;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Payment methods</h1>
      <MethodsList methods={h?.methods ?? []} readOnly={ctx.preview} />
      <h2 className="font-semibold">Add a payment method</h2>
      <Card className="p-4"><AddMethodForm disabled={ctx.preview} /></Card>
    </div>
  );
}
