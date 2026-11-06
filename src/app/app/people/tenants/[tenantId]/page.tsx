import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ListChecks, MessagesSquare } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { balancesBy } from "@/server/leasing/queries";
import { filesFor, notesFor } from "@/server/records/queries";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { TenantForm } from "@/components/leasing/tenant-form";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { ROLE_LABEL, tenantDisplayName } from "@/lib/leasing";

const TABS = ["overview", "leases", "tasks", "communications", "notes", "files"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ tenantId: string }> }) {
  const ctx = await requireContext();
  const t = await ctx.db.tenant.findFirst({ where: { id: (await params).tenantId } });
  return { title: t ? tenantDisplayName(t) : "Tenant" };
}

export default async function TenantPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { tenantId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) notFound();
  const t = await ctx.db.tenant.findFirst({
    where: { id: tenantId },
    include: { leases: { include: { lease: { include: { property: true, units: { include: { unit: true } } } } }, orderBy: { createdAt: "desc" } } },
  });
  if (!t) notFound();
  const scope = ctx.membership.propertyScope;
  const leases = t.leases.filter((l) => !scope.length || scope.includes(l.lease.propertyId));
  if (scope.length && leases.length === 0) notFound();
  const balances = await balancesBy(ctx, "leaseId", leases.map((l) => l.leaseId));
  const total = leases.reduce((s, l) => s + (balances.get(l.leaseId) ?? 0), 0);
  const current = leases.find((l) => ["ACTIVE", "EVICTION"].includes(l.lease.status));
  const name = tenantDisplayName(t);
  const canEdit = can(ctx.permissions, "people", "edit");
  const base = `/app/people/tenants/${t.id}`;

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/people/tenants" className="hover:underline">Tenants</Link> / {name}</>}
        title={name}
        status={<StatusBadge status={t.portalStatus} label={`Portal: ${t.portalStatus.replace("_", " ").toLowerCase()}`} />}
        subtitle={[t.email, t.phone].filter(Boolean).join(" · ") || undefined}
        stats={[
          { label: "Balance", value: <span className={total > 0 ? "text-danger" : ""}>{formatMoney(total)}</span> },
          { label: "Current unit", value: current ? `${current.lease.property.name} · ${current.lease.units.map((u) => u.unit.name).join(", ")}` : "—" },
          { label: "Leases", value: leases.length },
          { label: "Tenant since", value: leases.length ? formatDate(leases.map((l) => l.lease.startDate).sort((a, b) => a.getTime() - b.getTime())[0]!) : "—" },
        ]}
        actions={can(ctx.permissions, "leasing", "edit") ? <Button asChild variant="secondary"><Link href={`/app/new/lease?tenantId=${t.id}`} scroll={false}><Plus aria-hidden /> New lease</Link></Button> : null}
      />
      <EntityTabs base={base} active={tab} tabs={[{ id: "overview", label: "Overview" }, { id: "leases", label: "Leases", count: leases.length }, { id: "tasks", label: "Tasks" }, { id: "communications", label: "Communications" }, { id: "notes", label: "Notes" }, { id: "files", label: "Files" }]} />
      {tab === "overview" ? (
        <Card className="max-w-3xl">
          <CardHeader><CardTitle>{canEdit ? "Edit tenant" : "Contact"}</CardTitle></CardHeader>
          <CardContent>
            {canEdit ? (
              <TenantForm id={t.id} initial={{ kind: t.kind as "PERSON" | "COMPANY", firstName: t.firstName ?? "", lastName: t.lastName ?? "", companyName: t.companyName ?? "", email: t.email ?? "", phone: t.phone ?? "" }} />
            ) : (
              <p className="text-sm">{[t.email, t.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
            )}
          </CardContent>
        </Card>
      ) : tab === "leases" ? (
        leases.length ? (
          <div className="rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">Leases</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                <tr>{["Lease", "Role", "Dates", "Status", "Balance"].map((h) => <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {leases.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2.5"><Link href={`/app/leasing/${l.leaseId}`} className="font-medium hover:underline">{l.lease.property.name} · {l.lease.units.map((u) => u.unit.name).join(", ")}</Link></td>
                    <td className="px-4 py-2.5">{ROLE_LABEL[l.role]}</td>
                    <td className="px-4 py-2.5 tabular">{formatDate(l.lease.startDate)} – {l.lease.endDate ? formatDate(l.lease.endDate) : "M2M"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={l.lease.status} /></td>
                    <td className="px-4 py-2.5 tabular">{formatMoney(balances.get(l.leaseId) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No leases" description="Create a lease to connect this tenant to a unit." />
      ) : tab === "notes" ? (
        <NotesPanel entityType="Tenant" entityId={t.id} notes={await notesFor(ctx, "Tenant", t.id)} canEdit={canEdit} />
      ) : tab === "files" ? (
        <FilesPanel entityType="Tenant" entityId={t.id} files={await filesFor(ctx, "Tenant", t.id)} canEdit={canEdit} />
      ) : tab === "tasks" ? (
        <EmptyState icon={<ListChecks />} title="Requests arrive in Phase 5" description="Maintenance requests from this tenant." />
      ) : (
        <EmptyState icon={<MessagesSquare />} title="Communications arrive in Phase 8" description="Email, SMS and portal messages." />
      )}
    </>
  );
}
