import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { AutopayForm } from "@/components/portal/autopay-form";

export const metadata = { title: "Autopay" };

export default async function AutopayPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  if (!h || !ctx.lease) return null;
  const lease = await ctx.db.lease.findFirstOrThrow({ where: { id: ctx.lease.id } });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Autopay</h1>
      <p className="text-muted-foreground">{h.autopay ? `On — ${h.autopay.amountMode === "FIXED" ? "fixed amount" : "full balance"} on day ${h.autopay.dayOfMonth} from ${h.autopay.method}.` : "Off. Set it up once and rent pays itself."}</p>
      <AutopayForm methods={h.methods} current={h.autopay} rentCents={h.rentCents} rentDueDay={lease.rentDueDay} readOnly={ctx.preview} />
    </div>
  );
}
