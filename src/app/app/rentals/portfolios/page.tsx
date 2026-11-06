import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { PortfoliosManager } from "@/components/rentals/portfolios-manager";
import { propertyScopeWhere } from "@/server/rentals/service";

export const metadata = { title: "Portfolios" };

export default async function PortfoliosPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) return <Forbidden what="rentals" />;
  const rows = await ctx.db.portfolio.findMany({
    orderBy: { name: "asc" },
    include: {
      properties: {
        where: { deletedAt: null, ...propertyScopeWhere(ctx.membership.propertyScope) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, units: { where: { deletedAt: null }, select: { marketRentCents: true } } },
      },
    },
  });
  return (
    <>
      <PageHeader title="Portfolios" description="Groups of properties for filtering and reporting." />
      <PortfoliosManager
        canEdit={can(ctx.permissions, "rentals", "edit")}
        canDelete={can(ctx.permissions, "rentals", "delete")}
        rows={rows.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          properties: p.properties.map((x) => ({ id: x.id, name: x.name })),
          units: p.properties.reduce((s, x) => s + x.units.length, 0),
          marketRentCents: p.properties.reduce((s, x) => s + x.units.reduce((t, u) => t + u.marketRentCents, 0), 0),
        }))}
      />
    </>
  );
}
