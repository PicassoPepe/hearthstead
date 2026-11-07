import { ShieldCheck } from "lucide-react";
import type { AppContext } from "@/server/context";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { tenantDisplayName } from "@/lib/leasing";
import { VerifyInsuranceButton } from "./verify-insurance-button";

export async function AutopayStatus({ ctx, leaseId }: { ctx: AppContext; leaseId: string }) {
  const autopays = await ctx.db.autopay.findMany({ where: { leaseId, active: true } });
  if (!autopays.length) return <p><strong>Autopay:</strong> off. Tenants turn it on in the tenant portal.</p>;
  const [tenants, methods] = await Promise.all([
    ctx.db.tenant.findMany({ where: { id: { in: autopays.map((a) => a.tenantId) } } }),
    ctx.db.paymentMethod.findMany({ where: { id: { in: autopays.map((a) => a.paymentMethodId) } } }),
  ]);
  return (
    <ul className="space-y-1">
      {autopays.map((a) => {
        const t = tenants.find((x) => x.id === a.tenantId);
        const m = methods.find((x) => x.id === a.paymentMethodId);
        return (
          <li key={a.id}>
            <strong>Autopay on</strong> — {t ? tenantDisplayName(t) : "Tenant"} pays {a.amountMode === "FIXED" ? formatMoney(a.fixedCents ?? 0) : "the full balance"} on day {a.dayOfMonth}
            {m ? ` from ${m.type === "CARD" ? m.brand : m.bankName} ••${m.last4}` : ""}.
          </li>
        );
      })}
    </ul>
  );
}

export async function InsuranceList({ ctx, leaseId, canEdit }: { ctx: AppContext; leaseId: string; canEdit: boolean }) {
  const policies = await ctx.db.insurancePolicy.findMany({ where: { leaseId }, orderBy: { expiresOn: "desc" } });
  if (!policies.length) return <EmptyState icon={<ShieldCheck />} title="No insurance on file" description="Tenants upload proof of renters insurance in the tenant portal. Require it per lease in Settings → Tenant portal." />;
  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface">
      {policies.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{p.carrier} · {p.policyNumber}</div>
            <div className="text-xs text-muted-foreground">{formatDate(p.effectiveDate)} – {formatDate(p.expiresOn)}{p.liabilityCents ? ` · ${formatMoney(p.liabilityCents, { showCents: false })} liability` : ""}</div>
          </div>
          {p.attachmentId ? <a className="text-primary underline" href={`/api/files/${p.attachmentId}`} target="_blank" rel="noopener">View document</a> : null}
          <StatusBadge status={p.status === "VERIFIED" ? "ACTIVE" : "PENDING"} label={p.status === "VERIFIED" ? "Verified" : "Needs review"} />
          {canEdit ? <VerifyInsuranceButton id={p.id} verified={p.status === "VERIFIED"} /> : null}
        </div>
      ))}
    </div>
  );
}
