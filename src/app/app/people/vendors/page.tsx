import Link from "next/link";
import { Plus, Wrench } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { categoryLabel } from "@/lib/maintenance";
import { formatDate } from "@/lib/dates";
import { orgToday } from "@/server/leasing/queries";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) return <Forbidden what="people" />;
  const [vendors, today] = await Promise.all([
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { tasks: { where: { status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING"] } } } } } } }),
    orgToday(ctx),
  ]);
  const canEdit = can(ctx.permissions, "people", "edit");
  return (
    <>
      <PageHeader title="Vendors" description="Contractors and service companies, their trades, compliance and open work." actions={canEdit ? <Button asChild><Link href="/app/new/vendor" scroll={false}><Plus aria-hidden /> Add vendor</Link></Button> : null} />
      {vendors.length === 0 ? (
        <EmptyState icon={<Wrench />} title="Add your vendors" description="Plumbers, electricians, cleaners — assign them work orders, email the details, and turn their invoices into bills." action={canEdit ? <Button asChild><Link href="/app/new/vendor" scroll={false}><Plus aria-hidden /> Add vendor</Link></Button> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vendors.map((v) => {
            const expired = v.insuranceExpires && v.insuranceExpires < today;
            return (
              <Card key={v.id} className="p-4">
                <Link href={`/app/people/vendors/${v.id}`} className="font-semibold hover:underline">{v.name}</Link>
                <div className="text-sm text-muted-foreground">{[v.contactName, v.phone].filter(Boolean).join(" · ") || v.email || "No contact details"}</div>
                <div className="mt-2 flex flex-wrap gap-1">{v.trades.map((t) => <Badge key={t} tone="outline">{categoryLabel(t)}</Badge>)}</div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge tone={v._count.tasks ? "info" : "neutral"}>{v._count.tasks} open work order{v._count.tasks === 1 ? "" : "s"}</Badge>
                  {v.w9OnFile ? <Badge tone="success">W-9 on file</Badge> : <Badge tone="warning">No W-9</Badge>}
                  {v.insuranceExpires ? <Badge tone={expired ? "danger" : "neutral"}>{expired ? "Insurance expired" : "Insured until"} {formatDate(v.insuranceExpires)}</Badge> : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
