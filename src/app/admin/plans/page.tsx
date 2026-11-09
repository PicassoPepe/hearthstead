import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { ensurePlanCatalog } from "@/server/billing/catalog";
import { quote } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { PlanEditor } from "@/components/admin/plan-editor";

export const metadata = { title: "Plans & prices" };

export default async function AdminPlans() {
  await requirePlatformPage();
  await ensurePlanCatalog(adminDb);
  const [plans, counts] = await Promise.all([
    adminDb.plan.findMany({ orderBy: { sortOrder: "asc" } }),
    adminDb.subscription.groupBy({ by: ["planKey"], where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, _count: true }),
  ]);
  const subs = new Map(counts.map((c) => [c.planKey, c._count]));
  const examples = (p: (typeof plans)[number]) => {
    const u = p.mode === "ADDON" ? 0 : [p.unitMin || 1, p.unitMax ?? Math.max(300, p.unitMin * 3)].filter((x, i, a) => a.indexOf(x) === i);
    if (!Array.isArray(u)) return [];
    return u.flatMap((n) => (["month", "year"] as const).filter((i) => !Number.isNaN(quote(p, n, i))).map((i) => `${n} units: ${formatMoney(quote(p, n, i), { showCents: false })}/${i}`));
  };
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Plans &amp; prices</h1>
      <p className="text-sm text-muted-foreground">Changes apply to new checkouts right away — no code change needed. Existing subscribers keep their current Stripe price until it&apos;s changed in Stripe. Amounts are in dollars.</p>
      {plans.map((p) => (
        <PlanEditor key={p.key} plan={{ ...p, createdAt: undefined, updatedAt: undefined }} subscribers={subs.get(p.key) ?? 0} examples={examples(p)} />
      ))}
    </div>
  );
}
