import { ShieldCheck } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { InsuranceForm } from "@/components/portal/insurance-form";
import { getInsuranceProvider } from "@/adapters/insurance";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Renters insurance" };

export default async function InsurancePage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  const policies = ctx.lease ? await ctx.db.insurancePolicy.findMany({ where: { leaseId: ctx.lease.id }, orderBy: { expiresOn: "desc" } }) : [];
  const offer = await getInsuranceProvider().quote();
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Renters insurance</h1>
      {h?.settings.requireInsurance ? <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">Your lease requires renters insurance.</p> : null}
      {policies.length ? (
        <Card className="divide-y divide-border">
          {policies.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <div><div className="font-medium">{p.carrier} · {p.policyNumber}</div><div className="text-xs text-muted-foreground">{formatDate(p.effectiveDate)} – {formatDate(p.expiresOn)}</div></div>
              <StatusBadge status={p.status === "VERIFIED" ? "ACTIVE" : "PENDING"} label={p.status === "VERIFIED" ? "Verified" : "Under review"} />
            </div>
          ))}
        </Card>
      ) : null}
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Upload proof of insurance</h2>
        <InsuranceForm readOnly={ctx.preview} />
      </Card>
      <Card className="flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="text-sm">
          <div className="font-medium">Need a policy? {offer.partner} from {offer.monthly}/month</div>
          <p className="text-muted-foreground">{offer.blurb}</p>
          <a href={offer.url} className="mt-1 inline-block font-medium text-primary underline" target="_blank" rel="noopener">Get a quote</a>
        </div>
      </Card>
    </div>
  );
}
