import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { PUBLIC_STATUS_TEXT, categoryLabel } from "@/lib/maintenance";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Maintenance requests" };

export default async function RequestsPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  const requests = await ctx.db.task.findMany({ where: { tenantId: ctx.tenant.id, type: "TENANT_REQUEST" }, orderBy: { createdAt: "desc" } });
  const allowed = h?.settings.allowRequests ?? false;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance requests</h1>
        {allowed && !ctx.preview ? <Button asChild><Link href="/portal/tenant/requests/new"><Plus aria-hidden /> New request</Link></Button> : null}
      </div>
      {!allowed ? <Card className="p-4 text-sm text-muted-foreground">Online requests aren&apos;t available for your lease. Please call {ctx.org.phone ?? "the office"}.</Card> : null}
      {requests.length === 0 ? (
        <Card className="flex flex-col items-center p-8 text-center">
          <Wrench className="mb-2 size-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">No requests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Something broken? Submit a request with photos and we&apos;ll keep you posted.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {requests.map((r) => (
            <Link key={r.id} href={`/portal/tenant/requests/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.title}</div>
                <div className="text-sm text-muted-foreground">#{r.number} · {categoryLabel(r.category)} · {formatDate(r.createdAt)}</div>
              </div>
              <StatusBadge status={r.status} label={PUBLIC_STATUS_TEXT[r.status]} />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
