import { requireOwnerPortal } from "@/server/portal/owner-context";
import { Card } from "@/components/ui/card";
import { OwnerApprovalButtons } from "@/components/owner-portal/approval-buttons";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Approvals" };

export default async function OwnerApprovals() {
  const o = await requireOwnerPortal();
  const rows = await o.db.ownerApproval.findMany({ where: { propertyId: { in: o.propertyIds } }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100 });
  const pname = new Map(o.properties.map((p) => [p.id, p.name]));
  const pending = rows.filter((r) => r.status === "PENDING");
  const done = rows.filter((r) => r.status !== "PENDING");
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <p className="-mt-2 text-sm text-muted-foreground">{o.org.name} asks before paying large expenses on your properties.</p>
      {pending.length ? (
        <ul className="grid gap-3" data-testid="pending-approvals">
          {pending.map((r) => (
            <li key={r.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{r.title}</h2>
                  <span className="text-xl font-semibold tabular">{formatMoney(r.amountCents)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{pname.get(r.propertyId)} · requested {formatDate(r.createdAt)}</p>
                <OwnerApprovalButtons id={r.id} />
              </Card>
            </li>
          ))}
        </ul>
      ) : <Card className="p-6 text-center text-sm text-muted-foreground">Nothing waiting for you. 🎉</Card>}
      {done.length ? (
        <section aria-labelledby="past-h">
          <h2 id="past-h" className="mb-2 font-semibold">Past decisions</h2>
          <ul className="grid gap-1 text-sm">
            {done.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-2"><span>{r.title} · {pname.get(r.propertyId)}</span><span className="tabular">{formatMoney(r.amountCents)} · <strong className={r.status === "APPROVED" ? "text-success" : "text-danger"}>{r.status.toLowerCase()}</strong>{r.decidedByName ? ` by ${r.decidedByName}` : ""}</span></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
