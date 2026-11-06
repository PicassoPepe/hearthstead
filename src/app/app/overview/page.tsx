import Link from "next/link";
import { Building2, CalendarClock, CircleDollarSign, Home, Inbox, LineChart, Receipt, Users, Wallet } from "lucide-react";
import { requireContext } from "@/server/context";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GettingStarted, type ChecklistItem } from "@/components/overview/getting-started";
import { can } from "@/server/permissions";
import { formatMoney } from "@/lib/money";
import { balancesBy, occupiedUnitIds, orgToday } from "@/server/leasing/queries";
import { startOfMonth } from "@/lib/dates";

export const metadata = { title: "Overview" };

const WIDGETS = [
  { title: "Rent collected vs due", desc: "This month's collections progress.", icon: CircleDollarSign, phase: 7 },
  { title: "Outstanding balances", desc: "Who owes what, aged by 30/60/90.", icon: Wallet, phase: 7 },
  { title: "Occupancy & vacancies", desc: "Occupied, vacant and notice units.", icon: Home, phase: 7 },
  { title: "Leases expiring", desc: "Renewals due in the next 30/60/90 days.", icon: CalendarClock, phase: 7 },
  { title: "Open requests", desc: "Maintenance requests by status.", icon: Inbox, phase: 7 },
  { title: "P&L", desc: "Income vs expenses, last 6 months.", icon: LineChart, phase: 7 },
  { title: "Bills due", desc: "Payables due this week.", icon: Receipt, phase: 7 },
] as const;

export default async function OverviewPage() {
  const ctx = await requireContext();
  const scope = ctx.membership.propertyScope;
  const [org, memberCount, settingRows, propertyCount, unitAgg, ownerCount] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
    ctx.db.membership.count(),
    ctx.db.setting.findMany({ where: { scope: "ORG" }, select: { key: true } }),
    ctx.db.property.count({ where: scope.length ? { id: { in: scope } } : {} }),
    ctx.db.unit.aggregate({ where: { property: { deletedAt: null, ...(scope.length ? { id: { in: scope } } : {}) } }, _count: true, _sum: { marketRentCents: true } }),
    ctx.db.owner.count(),
  ]);
  const keys = new Set(settingRows.map((s) => s.key));
  const today = await orgToday(ctx);
  const [occupied, balances, collected] = await Promise.all([
    occupiedUnitIds(ctx, today),
    balancesBy(ctx, "leaseId"),
    ctx.db.leaseTransaction.aggregate({ where: { type: "PAYMENT", voidedAt: null, date: { gte: startOfMonth(today), lte: today }, ...(scope.length ? { lease: { propertyId: { in: scope } } } : {}) }, _sum: { amountCents: true }, _count: true }),
  ]);
  const owed = [...balances.values()].filter((b) => b > 0);
  const has = (prefix: string) => [...keys].some((k) => k.startsWith(prefix));

  const checklist: ChecklistItem[] = [
    { id: "company", label: "Add company details", description: "Address and phone appear on statements.", href: "/app/settings", done: Boolean(org.addressLine1 && org.phone) },
    { id: "team", label: "Invite a teammate", description: "Give your team the right role.", href: "/app/new/user", done: memberCount > 1 },
    { id: "late-fees", label: "Review your late-fee policy", description: "Grace period, amount and caps.", href: "/app/settings/late-fees", done: has("lateFees.") },
    { id: "portal", label: "Set up the tenant portal", description: "Choose what tenants can see and do.", href: "/app/settings/tenant-portal", done: has("tenantPortal.") },
    { id: "property", label: "Add your first property", description: "Units, owners and bank accounts.", href: propertyCount ? "/app/rentals" : "/app/new/property", done: propertyCount > 0 },
    { id: "payments", label: "Turn on online payments", description: "Collect rent by ACH and card.", href: "/app/settings/payments", done: false, phase: 4 },
  ];
  const showChecklist = ctx.user.preferences.checklistDismissed !== true && checklist.some((c) => !c.done);
  const firstName = ctx.user.name?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Good to see you, ${firstName}` : "Overview"}
        description={`Here's what's happening at ${ctx.org.name}.`}
        actions={
          can(ctx.permissions, "rentals", "edit") ? (
            <Button asChild variant="secondary">
              <Link href="/app/new/property" scroll={false}><Building2 aria-hidden /> Add property</Link>
            </Button>
          ) : null
        }
      />
      {showChecklist ? <GettingStarted items={checklist} /> : null}

      <section aria-labelledby="kpis" className="mb-6">
        <h2 id="kpis" className="sr-only">Key numbers</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Properties" value={propertyCount} href="/app/rentals" hint={propertyCount ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "Add your first property"} />
          <StatCard label="Units" value={unitAgg._count} href="/app/rentals/units" hint={unitAgg._count ? `${formatMoney(unitAgg._sum.marketRentCents ?? 0, { showCents: false })} / mo market rent` : "No units yet"} />
          <StatCard label="Occupancy" value={unitAgg._count ? `${Math.round((occupied.size / unitAgg._count) * 100)}%` : "—"} hint={`${occupied.size} of ${unitAgg._count} units occupied`} href="/app/rentals/units" />
          <StatCard label="Collected this month" value={formatMoney(collected._sum.amountCents ?? 0, { showCents: false })} hint={`${collected._count} payments · ${formatMoney(owed.reduce((s, b) => s + b, 0), { showCents: false })} outstanding`} href="/app/leasing" />
        </div>
      </section>

      <section aria-labelledby="widgets">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="widgets" className="text-[15px] font-semibold">Dashboard</h2>
          <span className="text-xs text-muted-foreground">Drag-and-drop widgets arrive in Phase 7</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {WIDGETS.map((w) => (
            <Card key={w.title}>
              <CardHeader>
                <div>
                  <CardTitle as="h3">{w.title}</CardTitle>
                  <CardDescription>{w.desc}</CardDescription>
                </div>
                <w.icon className="size-5 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border-strong text-center text-[13px] text-muted-foreground">
                  No data yet — this fills in once properties and leases exist.
                </div>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <div>
                <CardTitle as="h3">Your team</CardTitle>
                <CardDescription>{memberCount} member{memberCount === 1 ? "" : "s"}</CardDescription>
              </div>
              <Users className="size-5 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary" size="sm">
                <Link href="/app/new/user" scroll={false}>Invite a teammate</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
