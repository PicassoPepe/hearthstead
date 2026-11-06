import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listProperties } from "@/server/rentals/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { PropertiesTable } from "@/components/rentals/tables";
import { formatMoney, sumCents } from "@/lib/money";

export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) return <Forbidden what="rentals" />;
  const [rows, portfolios] = await Promise.all([listProperties(ctx), ctx.db.portfolio.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const units = rows.reduce((s, r) => s + r.units, 0);
  const canEdit = can(ctx.permissions, "rentals", "edit");
  return (
    <>
      <PageHeader
        title="Properties"
        description="Every building and home you manage."
        actions={
          canEdit ? (
            <>
              <Button asChild variant="secondary"><Link href="/app/files?import=properties"><Upload aria-hidden /> Import</Link></Button>
              <Button asChild><Link href="/app/new/property" scroll={false}><Plus aria-hidden /> Add property</Link></Button>
            </>
          ) : null
        }
      />
      {rows.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Properties" value={rows.length} />
          <StatCard label="Units" value={units} href="/app/rentals/units" hint="View all units" />
          <StatCard label="Portfolios" value={portfolios.length} href="/app/rentals/portfolios" hint="Manage" />
          <StatCard label="Market rent / mo" value={formatMoney(sumCents(rows.map((r) => r.marketRentCents)), { showCents: false })} />
        </div>
      ) : null}
      <PropertiesTable rows={rows} portfolios={portfolios} canEdit={canEdit} canDelete={can(ctx.permissions, "rentals", "delete")} />
    </>
  );
}
