import Link from "next/link";
import { Rocket, Building2, CircleDollarSign, DoorOpen, FileSignature, MessageSquare, PieChart, Wallet, Wrench } from "lucide-react";
import { requireContext } from "@/server/context";
import { StatCard } from "@/components/patterns/stat-card";
import { GettingStarted, type ChecklistItem } from "@/components/overview/getting-started";
import { can } from "@/server/permissions";
import { formatMoney } from "@/lib/money";
import { balancesBy, occupiedUnitIds, orgToday } from "@/server/leasing/queries";
import { startOfMonth } from "@/lib/dates";
import { Dashboard } from "@/components/overview/dashboard";
import { widgetData } from "@/server/overview/widgets";
import { PRESETS, WIDGET_IDS, WIDGET_META, redactWidgetData, sanitizeLayout } from "@/lib/widgets";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; portfolioId?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const scope = ctx.membership.propertyScope;
  const [org, memberCount, settingRows, propertyCount, unitAgg, ownerCount, processor, leaseCount, invitedTenants] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
    ctx.db.membership.count(),
    ctx.db.setting.findMany({ where: { scope: "ORG" }, select: { key: true } }),
    ctx.db.property.count({ where: scope.length ? { id: { in: scope } } : {} }),
    ctx.db.unit.aggregate({ where: { property: { deletedAt: null, ...(scope.length ? { id: { in: scope } } : {}) } }, _count: true, _sum: { marketRentCents: true } }),
    ctx.db.owner.count(),
    ctx.db.processorAccount.findFirst({ select: { id: true } }),
    ctx.db.lease.count(),
    ctx.db.tenantUser.count(),
  ]);
  const keys = new Set(settingRows.map((s) => s.key));
  const today = await orgToday(ctx);
  const [occupied, balances, collected] = await Promise.all([
    occupiedUnitIds(ctx, today),
    balancesBy(ctx, "leaseId"),
    ctx.db.leaseTransaction.aggregate({ where: { type: "PAYMENT", voidedAt: null, date: { gte: startOfMonth(today), lte: today }, ...(scope.length ? { lease: { propertyId: { in: scope } } } : {}) }, _sum: { amountCents: true }, _count: true }),
  ]);
  const filter = { propertyId: sp.propertyId ?? "", portfolioId: sp.portfolioId ?? "" };
  const [widgets, dashProps, dashPortfolios] = await Promise.all([
    widgetData(ctx, filter, today),
    ctx.db.property.findMany({ where: scope.length ? { id: { in: scope } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.portfolio.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const allowedWidgets = WIDGET_IDS.filter((id) => can(ctx.permissions, WIDGET_META[id].module as Parameters<typeof can>[1], "view"));
  const owed = [...balances.values()].filter((b) => b > 0);
  const has = (prefix: string) => [...keys].some((k) => k.startsWith(prefix));

  const checklist: ChecklistItem[] = [
    { id: "company", label: "Add company details", description: "Address and phone appear on statements and portals.", href: "/app/setup?step=1", done: Boolean(org.addressLine1 && org.phone) },
    { id: "logo", label: "Upload your logo", description: "Shown in the app, portals and on your listings site.", href: "/app/settings", done: Boolean(org.logoUrl) },
    { id: "property", label: "Add your first property", description: "Units, rents, owners and bank accounts.", href: propertyCount ? "/app/rentals" : "/app/new/property", done: propertyCount > 0 },
    { id: "lease", label: "Add a lease", description: "Tenants and rent — charges post automatically.", href: "/app/new/lease", done: leaseCount > 0 },
    { id: "payments", label: "Turn on online payments", description: "Collect rent by ACH and card.", href: "/app/setup?step=3", done: Boolean(processor) },
    { id: "portal", label: "Invite tenants to the portal", description: "They pay, set up autopay and send requests online.", href: "/app/people/tenants", done: invitedTenants > 0 },
    { id: "late-fees", label: "Review your late-fee policy", description: "Grace period, amount and caps.", href: "/app/settings/late-fees", done: has("lateFees.") },
    { id: "team", label: "Invite a teammate", description: "Give your team the right role.", href: "/app/setup?step=4", done: memberCount > 1 },
  ];

  const showChecklist = ctx.user.preferences.checklistDismissed !== true && checklist.some((c) => !c.done);
  const firstName = ctx.user.name?.split(" ")[0];
  const quickActions = [
    { label: "Add property", href: "/app/new/property", icon: Building2, ok: can(ctx.permissions, "rentals", "edit") },
    { label: "New lease", href: "/app/new/lease", icon: FileSignature, ok: can(ctx.permissions, "leasing", "edit") },
    { label: "Record payment", href: "/app/new/payment", icon: Wallet, ok: can(ctx.permissions, "leasing", "edit") },
    { label: "New task", href: "/app/new/task", icon: Wrench, ok: can(ctx.permissions, "tasks", "edit") },
    { label: "Message", href: "/app/communications", icon: MessageSquare, ok: can(ctx.permissions, "communications", "view") },
  ].filter((q) => q.ok);

  return (
    <>
      <section aria-labelledby="hero-h" className="relative mb-6 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#0b3532] via-[#0f5a52] to-[#0f766e] p-6 text-white shadow-pop sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-amber-300/20 blur-2xl" />
        <p className="relative text-sm text-teal-100">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 id="hero-h" className="relative mt-1 font-display text-3xl font-bold tracking-tight">{firstName ? `Good to see you, ${firstName}` : "Overview"}</h1>
        <p className="relative mt-1 max-w-2xl text-teal-50">Here&apos;s what&apos;s happening at {ctx.org.name}.</p>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {quickActions.map((q) => (
            <Link key={q.href} href={q.href} scroll={false} className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 focus-visible:outline-white">
              <q.icon className="size-4" aria-hidden /> {q.label}
            </Link>
          ))}
        </div>
      </section>
      {propertyCount === 0 && ctx.user.preferences.setupDone !== true && can(ctx.permissions, "settings", "edit") ? (
        <section aria-labelledby="welcome-h" className="mb-6 flex flex-col gap-4 rounded-card border border-primary/30 bg-primary-soft/40 p-5 sm:flex-row sm:items-center">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Rocket className="size-6" /></span>
          <div className="flex-1">
            <h2 id="welcome-h" className="text-lg font-semibold">Welcome! Let&apos;s get {ctx.org.name} set up</h2>
            <p className="text-sm text-muted-foreground">Company details, your first property (or sample data to explore), online payments and your team — about 5 minutes.</p>
          </div>
          <Link href="/app/setup" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover">Start setup</Link>
        </section>
      ) : null}
      {org.isSandbox ? (
        <p role="status" className="mb-6 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
          <strong>You&apos;re exploring sample data.</strong> This sandbox is separate from your real company — try anything. Switch back from the account menu (top right).
        </p>
      ) : null}
      {showChecklist ? <GettingStarted items={checklist} /> : null}

      <section aria-labelledby="kpis" className="mb-6">
        <h2 id="kpis" className="sr-only">Key numbers</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={<Building2 />} label="Properties" value={propertyCount} href="/app/rentals" hint={propertyCount ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "Add your first property"} />
          <StatCard icon={<DoorOpen />} label="Units" value={unitAgg._count} href="/app/rentals/units" hint={unitAgg._count ? `${formatMoney(unitAgg._sum.marketRentCents ?? 0, { showCents: false })} / mo market rent` : "No units yet"} />
          <StatCard icon={<PieChart />} label="Occupancy" value={unitAgg._count ? `${Math.round((occupied.size / unitAgg._count) * 100)}%` : "—"} hint={`${occupied.size} of ${unitAgg._count} units occupied`} href="/app/rentals/units" />
          <StatCard icon={<CircleDollarSign />} label="Collected this month" value={formatMoney(collected._sum.amountCents ?? 0, { showCents: false })} hint={`${collected._count} payments · ${formatMoney(owed.reduce((s, b) => s + b, 0), { showCents: false })} outstanding`} href="/app/leasing" />
        </div>
      </section>

      <Dashboard
        data={redactWidgetData(widgets, allowedWidgets)}
        layout={sanitizeLayout(ctx.user.preferences.dashboard, PRESETS[ctx.membership.roleKey ?? "default"]?.layout)}
        allowed={allowedWidgets}
        filter={filter}
        properties={dashProps}
        portfolios={scope.length ? [] : dashPortfolios}
      />
    </>
  );
}
