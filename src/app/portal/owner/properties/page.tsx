import Link from "next/link";
import { requireOwnerPortal, ownerReportContext } from "@/server/portal/owner-context";
import { incomeExpense } from "@/server/reports/engine";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Properties" };

export default async function OwnerProperties() {
  const o = await requireOwnerPortal();
  const t = toISODate(o.today);
  const [props, occupied, ie, accts] = await Promise.all([
    o.db.property.findMany({ where: { id: { in: o.propertyIds } }, orderBy: { name: "asc" }, include: { units: { where: { deletedAt: null }, select: { id: true, marketRentCents: true } } } }),
    o.db.leaseUnit.findMany({ where: { lease: { propertyId: { in: o.propertyIds }, status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: o.today }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: o.today } }] } }, select: { unitId: true } }),
    incomeExpense(ownerReportContext(o), { from: `${t.slice(0, 4)}-01-01`, to: t, basis: "ACCRUAL", propertyIds: o.propertyIds, col: (_d, p) => p ?? "" }),
    o.db.account.findMany({ where: { type: { in: ["INCOME", "EXPENSE"] } }, select: { id: true, type: true } }),
  ]);
  const occ = new Set(occupied.map((x) => x.unitId));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Your properties</h1>
      <ul className="grid gap-3 md:grid-cols-2">
        {props.map((p) => {
          const pct = o.properties.find((x) => x.id === p.id)?.percentBps ?? 0;
          let inc = 0;
          let exp = 0;
          for (const a of accts) { const v = ie.get(a.id)?.get(p.id) ?? 0; if (a.type === "INCOME") inc += v; else exp += v; }
          const o2 = p.units.filter((u) => occ.has(u.id)).length;
          return (
            <li key={p.id}>
              <Card className="overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.photoUrl ? <img src={p.photoUrl} alt="" className="h-40 w-full object-cover" /> : null}
                <div className="p-4">
                <h2 className="font-semibold"><Link href={`/portal/owner/properties/${p.id}`} className="hover:underline">{p.name}</Link></h2>
                <p className="text-sm text-muted-foreground">{p.addressLine1}, {p.city} · you own {pct / 100}%</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted-foreground">Occupancy</dt><dd className="font-semibold tabular">{o2}/{p.units.length}</dd></div>
                  <div><dt className="text-muted-foreground">Income YTD</dt><dd className="font-semibold tabular">{formatMoney(inc, { showCents: false })}</dd></div>
                  <div><dt className="text-muted-foreground">Net YTD</dt><dd className="font-semibold tabular">{formatMoney(inc - exp, { showCents: false })}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Property totals. Your share of net: {formatMoney(Math.round((inc - exp) * (pct / 10_000)), { showCents: false })}</p>
                <p className="mt-2 text-sm"><Link href={`/portal/owner/properties/${p.id}`} className="font-medium text-primary hover:underline">Land records, lot lines &amp; deed →</Link></p>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
