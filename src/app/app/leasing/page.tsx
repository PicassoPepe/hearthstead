import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listLeases, orgToday } from "@/server/leasing/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatCard } from "@/components/patterns/stat-card";
import { Button } from "@/components/ui/button";
import { LeasesTable } from "@/components/leasing/leases-table";
import { formatMoney } from "@/lib/money";
import { addDays } from "@/lib/dates";
import { RunJobsButton } from "@/components/leasing/run-jobs-button";

export const metadata = { title: "Leases" };

export default async function LeasingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: t } = await searchParams;
  const tab = ["active", "drafts", "expiring", "ended"].includes(t ?? "") ? t! : "active";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="leasing" />;
  const today = await orgToday(ctx);
  const where: Prisma.LeaseWhereInput =
    tab === "drafts" ? { status: "DRAFT" }
    : tab === "ended" ? { status: "ENDED" }
    : tab === "expiring" ? { status: { in: ["ACTIVE", "EVICTION"] }, termType: "FIXED", endDate: { lte: addDays(today, 90) }, moveOutDate: null }
    : { status: { in: ["ACTIVE", "EVICTION"] } };
  const [rows, active] = await Promise.all([listLeases(ctx, where), tab === "active" ? null : listLeases(ctx, { status: { in: ["ACTIVE", "EVICTION"] } })]);
  const act = active ?? rows;
  const owed = act.filter((r) => r.balanceCents > 0);
  const canEdit = can(ctx.permissions, "leasing", "edit");
  return (
    <>
      <PageHeader
        title="Leases"
        description="Every lease, its rent and its balance."
        actions={
          <>
            {can(ctx.permissions, "accounting", "delete") ? <RunJobsButton /> : null}
            {canEdit ? <Button asChild><Link href="/app/new/lease" scroll={false}><Plus aria-hidden /> New lease</Link></Button> : null}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active leases" value={act.length} />
        <StatCard label="Monthly rent roll" value={formatMoney(act.reduce((s, r) => s + r.rentCents, 0), { showCents: false })} />
        <StatCard label="Tenants owing" value={owed.length} hint={formatMoney(owed.reduce((s, r) => s + r.balanceCents, 0))} />
        <StatCard label="Ending in 60 days" value={act.filter((r) => r.daysToEnd != null && r.daysToEnd >= 0 && r.daysToEnd <= 60).length} href="/app/leasing?tab=expiring" hint="Plan renewals" />
      </div>
      <EntityTabs
        base="/app/leasing"
        active={tab}
        tabs={[
          { id: "active", label: "Active" },
          { id: "drafts", label: "Drafts" },
          { id: "expiring", label: "Expiring / renewals" },
          { id: "ended", label: "Ended" },
        ]}
      />
      <LeasesTable key={tab} rows={rows} tab={tab} canEdit={canEdit} />
    </>
  );
}
