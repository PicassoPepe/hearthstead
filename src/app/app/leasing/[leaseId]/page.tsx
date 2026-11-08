import Link from "next/link";
import { notFound } from "next/navigation";
import { InsuranceList, AutopayStatus } from "@/components/payments/lease-payment-panels";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { ledger, moneyOptions, orgToday } from "@/server/leasing/queries";
import { filesFor, notesFor } from "@/server/records/queries";
import * as M from "@/server/leasing/money";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EntityTasks } from "@/components/tasks/entity-tasks";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { ESignPanel } from "@/components/funnel/esign-panel";
import { CommLog } from "@/components/comms/comm-log";
import { ScopedSettings } from "@/components/settings/scoped-settings";
import { LeaseActions } from "@/components/leasing/lease-actions";
import { LedgerTable } from "@/components/leasing/ledger-table";
import { formatMoney } from "@/lib/money";
import { RecurringEditor } from "@/components/leasing/recurring-editor";
import { diffDays, formatDate, toISODate } from "@/lib/dates";
import { ROLE_LABEL, TX_LABEL, tenantDisplayName } from "@/lib/leasing";
import { cn } from "@/lib/utils";

const TABS = ["overview", "transactions", "rent", "tenants", "tasks", "communications", "notes", "files", "insurance", "settings"] as const;
type Tab = (typeof TABS)[number];

async function load(leaseId: string) {
  const ctx = await requireContext();
  const lease = await ctx.db.lease.findFirst({
    where: { id: leaseId },
    include: {
      property: true,
      units: { include: { unit: true } },
      tenants: { include: { tenant: true }, orderBy: { role: "asc" } },
      recurring: { where: { deletedAt: null }, include: { account: true, runs: { select: { id: true }, take: 1 } }, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }] },
    },
  });
  return { ctx, lease };
}

export async function generateMetadata({ params }: { params: Promise<{ leaseId: string }> }) {
  const { lease } = await load((await params).leaseId);
  return { title: lease ? `${lease.property.name} · ${lease.units.map((u) => u.unit.name).join(", ")}` : "Lease" };
}

export default async function LeasePage({ params, searchParams }: { params: Promise<{ leaseId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { leaseId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const { ctx, lease } = await load(leaseId);
  if (!lease || !can(ctx.permissions, "leasing", "view") || !canAccessProperty(ctx.membership.propertyScope, lease.propertyId)) notFound();

  const [bal, held, rows, options, today] = await Promise.all([
    ctx.db.tx((tx) => M.leaseBalance(tx, lease.id)),
    ctx.db.tx((tx) => M.depositHeld(tx, lease.id)),
    ledger(ctx, lease.id),
    moneyOptions(ctx),
    orgToday(ctx),
  ]);
  const base = `/app/leasing/${lease.id}`;
  const title = `${lease.property.name} · ${lease.units.map((u) => u.unit.name).join(", ")}`;
  const tenants = lease.tenants.map((t) => tenantDisplayName(t.tenant)).join(", ");
  const rent = lease.recurring.filter((r) => r.kind === "RENT" && (!r.endDate || r.endDate >= today)).reduce((s, r) => s + r.amountCents, 0);
  const canEdit = can(ctx.permissions, "leasing", "edit");
  const canMoney = can(ctx.permissions, "accounting", "edit");
  const open = rows.filter((r) => (r.remainingCents ?? 0) > 0);
  const aging = [0, 0, 0, 0];
  for (const r of open) {
    const age = diffDays(new Date(`${r.date}T00:00:00Z`), today);
    aging[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3]! += r.remainingCents ?? 0;
  }

  return (
    <>
      <EntityHeader
        breadcrumb={<><Link href="/app/leasing" className="hover:underline">Leases</Link> / {title}</>}
        title={title}
        status={<StatusBadge status={lease.status} />}
        subtitle={
          <>
            {tenants} · {formatDate(lease.startDate)} – {lease.termType === "FIXED" && lease.endDate ? formatDate(lease.endDate) : "month-to-month"}
            {lease.moveOutDate ? ` · move-out ${formatDate(lease.moveOutDate)}` : ""}
          </>
        }
        stats={[
          {
            label: bal.balanceCents < 0 ? "Credit balance" : "Balance due",
            value: (
              <span className={cn("text-2xl", bal.balanceCents > 0 ? "text-danger" : bal.balanceCents < 0 ? "text-success" : "")} data-testid="lease-balance">
                {formatMoney(Math.abs(bal.balanceCents))}
              </span>
            ),
          },
          { label: "Monthly rent", value: formatMoney(rent) },
          { label: "Deposit held", value: `${formatMoney(held)}${lease.depositCents && held < lease.depositCents ? ` of ${formatMoney(lease.depositCents)}` : ""}` },
          { label: "Rent due", value: `Day ${lease.rentDueDay}` },
        ]}
        actions={<LeaseActions leaseId={lease.id} status={lease.status} balanceCents={bal.balanceCents} options={options} canMoney={canMoney} canEdit={canEdit} />}
      />
      <EntityTabs
        base={base}
        active={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "transactions", label: "Transactions", count: rows.length },
          { id: "rent", label: "Rent" },
          { id: "tenants", label: "Tenants", count: lease.tenants.length },
          { id: "tasks", label: "Tasks" },
          { id: "communications", label: "Communications" },
          { id: "notes", label: "Notes" },
          { id: "files", label: "Files" },
          { id: "insurance", label: "Insurance" },
          { id: "settings", label: "Settings" },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Open charges</CardTitle></CardHeader>
            <CardContent>
              {open.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing owed. {bal.prepaidCents > 0 ? `${formatMoney(bal.prepaidCents)} credit will apply to the next charge.` : ""}</p>
              ) : (
                <>
                  <dl className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
                    {["0–30 days", "31–60", "61–90", "90+"].map((l, i) => (
                      <div key={l} className="rounded-lg bg-surface-muted p-2">
                        <dt className="text-muted-foreground">{l}</dt>
                        <dd className={cn("tabular text-sm font-semibold", i > 0 && aging[i]! > 0 && "text-danger")}>{formatMoney(aging[i]!)}</dd>
                      </div>
                    ))}
                  </dl>
                  <ul className="divide-y divide-border text-sm">
                    {open.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2 py-2">
                        <span>{formatDate(r.date)} · {r.memo}</span>
                        <span className="tabular font-medium">{formatMoney(r.remainingCents ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Tenants</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {lease.tenants.map((t) => (
                  <li key={t.id}>
                    <Link href={`/app/people/tenants/${t.tenantId}`} className="font-medium hover:underline">{tenantDisplayName(t.tenant)}</Link>
                    <div className="text-xs text-muted-foreground">{ROLE_LABEL[t.role]}{t.tenant.email ? ` · ${t.tenant.email}` : ""}</div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <Link href={`${base}?tab=transactions`} className="text-sm font-medium text-primary hover:underline">Full ledger</Link>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{lease.status === "DRAFT" ? "This is a draft. Activate it to post the deposit and rent." : "No transactions yet."}</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {rows.slice(0, 6).map((r) => (
                    <li key={r.id} className={cn("flex justify-between gap-2 py-2", r.voided && "text-muted-foreground line-through")}>
                      <span>{formatDate(r.date)} · <Badge tone="outline">{TX_LABEL[r.type]}</Badge> {r.memo}</span>
                      <span className="tabular">{r.effectCents < 0 ? "−" : ""}{formatMoney(r.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "transactions" ? (
        <LedgerTable rows={rows} canVoid={canMoney} today={options.today} />
      ) : tab === "rent" ? (
        <div className="grid gap-4">
          <RecurringEditor
            leaseId={lease.id}
            draft={lease.status === "DRAFT"}
            canEdit={canEdit && !["ENDED", "CANCELLED"].includes(lease.status)}
            accounts={options.incomeAccounts}
            rows={lease.recurring.map((r) => ({
              id: r.id, kind: r.kind, description: r.description, account: `${r.account.code} · ${r.account.name}`, amountCents: r.amountCents,
              startDate: toISODate(r.startDate), endDate: r.endDate ? toISODate(r.endDate) : null, nextRunDate: toISODate(r.nextRunDate),
              status: r.endDate && r.nextRunDate > r.endDate ? "Finished" : r.startDate > today ? "Scheduled" : "Active",
              earliestChange: toISODate(r.runs.length ? r.nextRunDate : r.startDate),
            }))}
          />
          <Card className="p-4 text-sm">
            <AutopayStatus ctx={ctx} leaseId={lease.id} />
            <p className="mt-1 text-muted-foreground">Raise rent for many leases at once in <Link className="font-medium text-primary hover:underline" href="/app/leasing/rent-increase">Rent increases</Link>, or offer a renewal from <Link className="font-medium text-primary hover:underline" href="/app/leasing/renewals">Renewals</Link>.</p>
          </Card>
        </div>
      ) : tab === "tenants" ? (
        <div className="grid gap-3 md:grid-cols-2">
          {lease.tenants.map((t) => (
            <Card key={t.id} className="p-4">
              <Link href={`/app/people/tenants/${t.tenantId}`} className="font-semibold hover:underline">{tenantDisplayName(t.tenant)}</Link>
              <div className="mt-0.5 text-sm text-muted-foreground">{ROLE_LABEL[t.role]}</div>
              <dl className="mt-3 grid gap-1 text-sm">
                <div><dt className="sr-only">Email</dt><dd>{t.tenant.email ?? "No email"}</dd></div>
                <div><dt className="sr-only">Phone</dt><dd>{t.tenant.phone ?? "No phone"}</dd></div>
                <div><dt className="sr-only">Portal</dt><dd><StatusBadge status={t.tenant.portalStatus} label={`Portal: ${t.tenant.portalStatus.replace("_", " ").toLowerCase()}`} /></dd></div>
              </dl>
            </Card>
          ))}
        </div>
      ) : tab === "notes" ? (
        <NotesPanel entityType="Lease" entityId={lease.id} notes={await notesFor(ctx, "Lease", lease.id)} canEdit={canEdit} />
      ) : tab === "files" ? (
        <>
          <ESignPanel ctx={ctx} leaseId={lease.id} canEdit={canEdit} />
          <FilesPanel entityType="Lease" entityId={lease.id} files={await filesFor(ctx, "Lease", lease.id)} canEdit={canEdit} />
        </>
      ) : tab === "settings" ? (
        <ScopedSettings ctx={ctx} scope="LEASE" scopeId={lease.id} propertyId={lease.propertyId} canEdit={canEdit} />
      ) : tab === "insurance" ? (
        <InsuranceList ctx={ctx} leaseId={lease.id} canEdit={canEdit} />
      ) : tab === "tasks" ? (
        <EntityTasks ctx={ctx} where={{ OR: [{ leaseId: lease.id }, { unitId: { in: lease.units.map((u) => u.unitId) } }] }} newHref={`/app/new/task?leaseId=${lease.id}&propertyId=${lease.propertyId}`} tableId="lease-tasks" />
      ) : (
        <div className="grid gap-6">
          {lease.tenants.map((t) => (
            <section key={t.tenantId} aria-label={`Communications with ${t.tenant.firstName ?? t.tenant.companyName ?? "tenant"}`}>
              <h2 className="mb-2 font-semibold">{[t.tenant.firstName, t.tenant.lastName].filter(Boolean).join(" ") || t.tenant.companyName}</h2>
              <CommLog ctx={ctx} who={{ tenantId: t.tenantId }} email={t.tenant.email} />
            </section>
          ))}
        </div>
      )}
      <p className="sr-only">Ledger dates as of {toISODate(today)}</p>
    </>
  );
}
