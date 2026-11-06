import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks, MessagesSquare, ShieldCheck } from "lucide-react";
import { requireContext } from "@/server/context";
import { can, canAccessProperty } from "@/server/permissions";
import { ledger, moneyOptions, orgToday } from "@/server/leasing/queries";
import { filesFor, notesFor } from "@/server/records/queries";
import * as M from "@/server/leasing/money";
import { EntityHeader } from "@/components/patterns/entity-header";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotesPanel } from "@/components/records/notes-panel";
import { FilesPanel } from "@/components/records/files-panel";
import { ScopedSettings } from "@/components/settings/scoped-settings";
import { LeaseActions } from "@/components/leasing/lease-actions";
import { LedgerTable } from "@/components/leasing/ledger-table";
import { formatMoney } from "@/lib/money";
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
      recurring: { where: { deletedAt: null }, include: { account: true }, orderBy: { createdAt: "asc" } },
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
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">Recurring charges</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                <tr>{["Charge", "Account", "Amount", "Starts", "Ends", "Next posts"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {lease.recurring.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.description} <Badge tone={r.kind === "RENT" ? "primary" : "neutral"}>{r.kind === "RENT" ? "Rent" : "Other"}</Badge></td>
                    <td className="px-3 py-2">{r.account.code} · {r.account.name}</td>
                    <td className="px-3 py-2 tabular">{formatMoney(r.amountCents)} / mo</td>
                    <td className="px-3 py-2 tabular">{formatDate(r.startDate)}</td>
                    <td className="px-3 py-2 tabular">{r.endDate ? formatDate(r.endDate) : "—"}</td>
                    <td className="px-3 py-2 tabular">{r.endDate && r.nextRunDate > r.endDate ? "Finished" : lease.status === "DRAFT" ? "On activation" : formatDate(r.nextRunDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lease.recurring.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No recurring charges.</p> : null}
          </div>
          <Card className="p-4 text-sm">
            <p><strong>Autopay:</strong> not set up. Tenants turn on autopay from the tenant portal (Phase 4).</p>
            <p className="mt-1 text-muted-foreground">Scheduled rent increases and renewals arrive in Phase 9.</p>
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
        <FilesPanel entityType="Lease" entityId={lease.id} files={await filesFor(ctx, "Lease", lease.id)} canEdit={canEdit} />
      ) : tab === "settings" ? (
        <ScopedSettings ctx={ctx} scope="LEASE" scopeId={lease.id} propertyId={lease.propertyId} canEdit={canEdit} />
      ) : tab === "insurance" ? (
        <EmptyState icon={<ShieldCheck />} title="Renters insurance arrives in Phase 4" description="Tenants upload proof of insurance (or buy a policy through a partner) in the tenant portal." />
      ) : tab === "tasks" ? (
        <EmptyState icon={<ListChecks />} title="Tasks arrive in Phase 5" description="Maintenance requests and work orders for this lease's unit." />
      ) : (
        <EmptyState icon={<MessagesSquare />} title="Communications arrive in Phase 8" description="Every email, SMS and portal message with these tenants." />
      )}
      <p className="sr-only">Ledger dates as of {toISODate(today)}</p>
    </>
  );
}
