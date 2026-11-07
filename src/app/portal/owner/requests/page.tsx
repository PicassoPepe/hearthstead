import { requireOwnerPortal } from "@/server/portal/owner-context";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { OwnerRequestForm } from "@/components/owner-portal/owner-request-form";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Requests" };

export default async function OwnerRequests() {
  const o = await requireOwnerPortal();
  const tasks = await o.db.task.findMany({ where: { ownerId: o.owner.id, type: "OWNER_REQUEST", propertyId: { in: o.propertyIds } }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
      <Card className="p-4"><h2 className="mb-3 font-semibold">New request</h2><OwnerRequestForm properties={o.properties} /></Card>
      <Card className="divide-y divide-border">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <div><div className="font-medium">#{t.number} {t.title}</div><div className="text-muted-foreground">{o.properties.find((p) => p.id === t.propertyId)?.name} · {formatDate(t.createdAt)}</div></div>
            <StatusBadge status={t.status} />
          </div>
        ))}
        {!tasks.length ? <p className="p-6 text-center text-sm text-muted-foreground">No requests yet.</p> : null}
      </Card>
    </div>
  );
}
