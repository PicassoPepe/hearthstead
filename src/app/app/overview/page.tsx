import Link from "next/link";
import { Rocket, Building2, CircleDollarSign, DoorOpen, FileSignature, MessageSquare, PieChart, Wallet, Wrench, UserPlus, CheckCircle2, ChevronRight, Receipt, Siren } from "lucide-react";
import { BigActions, type BigAction } from "@/components/patterns/big-actions";
import { addDays } from "@/lib/dates";
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

export const metadata = { title: "Home" };

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
  const doThings: BigAction[] = ([
    { label: "Report a repair", hint: "Something is broken — add photos", href: "/app/new/repair", icon: Wrench, tone: "primary", ok: can(ctx.permissions, "tasks", "edit") },
    { label: "Record a rent payment", hint: "A tenant paid you (cash, check, etc.)", href: "/app/new/payment", icon: Wallet, tone: "primary", ok: can(ctx.permissions, "leasing", "edit") },
    { label: "Add a tenant", hint: "Someone is moving in — set up their lease", href: "/app/new/lease", icon: UserPlus, ok: can(ctx.permissions, "leasing", "edit") },
    { label: "Add a property", hint: "A house or building you rent out", href: "/app/new/property", icon: Building2, ok: can(ctx.permissions, "rentals", "edit") },
    { label: "Send a message", hint: "Text or email a tenant or owner", href: "/app/communications", icon: MessageSquare, ok: can(ctx.permissions, "communications", "view") },
    { label: "See who owes rent", hint: "Everyone who is behind", href: "/app/money#who-owes", icon: CircleDollarSign, ok: can(ctx.permissions, "accounting", "view") || can(ctx.permissions, "leasing", "view") },
  ] as (BigAction & { ok: boolean })[]).filter((a) => a.ok);

  const canTasks = can(ctx.permissions, "tasks", "view");
  const scopeTask = scope.length ? { propertyId: { in: scope } } : {};
  const [newRequests, emergencies, unreadConvos, billsDue, endingSoon] = await Promise.all([
    canTasks ? ctx.db.task.count({ where: { ...scopeTask, type: "TENANT_REQUEST", status: "NOT_STARTED" } }) : 0,
    canTasks ? ctx.db.task.count({ where: { ...scopeTask, priority: "URGENT", status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING"] } } }) : 0,
    can(ctx.permissions, "communications", "view") ? ctx.db.conversation.count({ where: { unreadCount: { gt: 0 } } }) : 0,
    can(ctx.permissions, "accounting", "view") ? ctx.db.bill.count({ where: { status: { in: ["OPEN", "PARTIALLY_PAID"] }, dueDate: { lte: addDays(today, 7) } } }) : 0,
    can(ctx.permissions, "leasing", "view") ? ctx.db.lease.count({ where: { status: "ACTIVE", endDate: { gte: today, lte: addDays(today, 60) }, ...(scope.length ? { propertyId: { in: scope } } : {}) } }) : 0,
  ]);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const attention = [
    { n: emergencies, text: `${plural(emergencies, "emergency repair is", "emergency repairs are")} not finished`, href: "/app/tasks?show=emergencies", icon: Siren, danger: true },
    { n: owed.length, text: `${plural(owed.length, "tenant owes", "tenants owe")} rent (${formatMoney(owed.reduce((s, b) => s + b, 0), { showCents: false })} total)`, href: "/app/money#who-owes", icon: CircleDollarSign, danger: false },
    { n: newRequests, text: `${plural(newRequests, "new repair request", "new repair requests")} from tenants`, href: "/app/tasks?show=requests", icon: Wrench, danger: false },
    { n: unreadConvos, text: `${plural(unreadConvos, "conversation has", "conversations have")} new messages`, href: "/app/communications", icon: MessageSquare, danger: false },
    { n: billsDue, text: `${plural(billsDue, "bill is", "bills are")} due this week or late`, href: "/app/accounting/bills", icon: Receipt, danger: false },
    { n: endingSoon, text: `${plural(endingSoon, "lease ends", "leases end")} in the next 60 days`, href: "/app/leasing/renewals", icon: FileSignature, danger: false },
  ].filter((a) => a.n > 0);

  return (
    <>
      <section aria-labelledby="hero-h" className="relative mb-6 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#0b3532] via-[#0f5a52] to-[#0f766e] p-6 text-white shadow-pop sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-amber-300/20 blur-2xl" />
        <p className="relative text-sm text-teal-100">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 id="hero-h" className="relative mt-1 font-display text-3xl font-bold tracking-tight">{firstName ? `Hi, ${firstName}` : "Home"}</h1>
        <p className="relative mt-1 max-w-2xl text-teal-50">This is your home page for {ctx.org.name}. Pick a big button below to get something done.</p>
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

      {doThings.length ? (
        <section aria-labelledby="do-h" className="mb-6">
          <h2 id="do-h" className="mb-3 text-xl font-bold">What do you want to do?</h2>
          <BigActions items={doThings} />
        </section>
      ) : null}

      <section aria-labelledby="attn-h" className="mb-6" data-testid="needs-attention">
        <h2 id="attn-h" className="mb-3 text-xl font-bold">Needs your attention</h2>
        {attention.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
            {attention.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex items-center gap-3 px-4 py-3.5 text-base hover:bg-surface-muted focus-visible:outline-2">
                  <a.icon className={a.danger ? "size-5 shrink-0 text-danger" : "size-5 shrink-0 text-primary"} aria-hidden />
                  <span className={a.danger ? "flex-1 font-semibold text-danger" : "flex-1"}>{a.text}</span>
                  <span className="flex items-center text-sm font-medium text-primary">Look <ChevronRight className="size-4" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-card border border-border bg-surface px-4 py-3.5 text-base"><CheckCircle2 className="size-5 text-success" aria-hidden /> All caught up — nothing needs you right now.</p>
        )}
      </section>

      <h2 className="mb-3 text-xl font-bold">Your numbers</h2>

      <section aria-labelledby="kpis" className="mb-6">
        <h2 id="kpis" className="sr-only">Key numbers</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={<Building2 />} label="Properties" value={propertyCount} href="/app/rentals" hint={propertyCount ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "Add your first property"} />
          <StatCard icon={<DoorOpen />} label="Units (homes & apartments)" value={unitAgg._count} href="/app/rentals/units" hint={unitAgg._count ? `${formatMoney(unitAgg._sum.marketRentCents ?? 0, { showCents: false })} / mo market rent` : "No units yet"} />
          <StatCard icon={<PieChart />} label="Rented out" value={unitAgg._count ? `${Math.round((occupied.size / unitAgg._count) * 100)}%` : "—"} hint={`${occupied.size} of ${unitAgg._count} have a tenant`} href="/app/rentals/units" />
          <StatCard icon={<CircleDollarSign />} label="Collected this month" value={formatMoney(collected._sum.amountCents ?? 0, { showCents: false })} hint={`${collected._count} payments · ${formatMoney(owed.reduce((s, b) => s + b, 0), { showCents: false })} outstanding`} href="/app/money" />
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
