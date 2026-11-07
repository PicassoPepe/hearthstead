import { redirect } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { Forbidden } from "@/components/patterns/forbidden";

/** Reconcile entry point: go to the operating account (others are linked from Banking). */
export default async function ReconcileIndex() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const a = await ctx.db.account.findFirst({ where: { systemKey: "OPERATING_CASH" } });
  redirect(a ? `/app/accounting/reconcile/${a.id}` : "/app/accounting/banking");
}
