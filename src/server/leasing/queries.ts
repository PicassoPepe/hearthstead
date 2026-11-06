import "server-only";
import type { Prisma } from "@prisma/client";
import type { AppContext } from "@/server/context";
import { balanceEffect, tenantDisplayName } from "@/lib/leasing";
import { diffDays, toISODate, todayIn } from "@/lib/dates";
import { adminDb } from "@/server/db";

/** Balances for many leases (or properties) in one grouped query: A/R − prepaid. */
export async function balancesBy(ctx: AppContext, dim: "leaseId" | "propertyId", ids?: string[]): Promise<Map<string, number>> {
  const accts = await ctx.db.account.findMany({ where: { systemKey: { in: ["ACCOUNTS_RECEIVABLE", "PREPAID_RENT"] } }, select: { id: true } });
  const rows = await ctx.db.journalLine.groupBy({
    by: [dim],
    where: { accountId: { in: accts.map((a) => a.id) }, ...(ids ? { [dim]: { in: ids } } : { [dim]: { not: null } }) },
    _sum: { debitCents: true, creditCents: true },
  });
  // Both accounts net the same way for the tenant: debits increase what's owed, credits reduce it.
  return new Map(rows.map((r) => [(r as Record<string, unknown>)[dim] as string, (r._sum.debitCents ?? 0) - (r._sum.creditCents ?? 0)]));
}

export async function orgToday(ctx: AppContext): Promise<Date> {
  const org = await adminDb.organization.findUnique({ where: { id: ctx.org.id }, select: { timezone: true } });
  return todayIn(org?.timezone ?? "America/New_York");
}

export type LeaseRow = {
  id: string;
  label: string;
  propertyId: string;
  propertyName: string;
  tenants: string;
  startDate: string;
  endDate: string | null;
  termType: string;
  rentCents: number;
  balanceCents: number;
  status: string;
  daysToEnd: number | null;
};

export async function listLeases(ctx: AppContext, where: Prisma.LeaseWhereInput = {}): Promise<LeaseRow[]> {
  const scope = ctx.membership.propertyScope;
  const leases = await ctx.db.lease.findMany({
    where: { ...where, ...(scope.length ? { propertyId: { in: scope } } : {}), property: { deletedAt: null } },
    include: {
      property: { select: { name: true } },
      units: { include: { unit: { select: { name: true } } } },
      tenants: { include: { tenant: true }, orderBy: { role: "asc" } },
      recurring: { where: { kind: "RENT", deletedAt: null } },
    },
    orderBy: [{ startDate: "desc" }],
  });
  const balances = await balancesBy(ctx, "leaseId", leases.map((l) => l.id));
  const today = await orgToday(ctx);
  return leases.map((l) => ({
    id: l.id,
    label: `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`,
    propertyId: l.propertyId,
    propertyName: l.property.name,
    tenants: l.tenants.map((t) => tenantDisplayName(t.tenant)).join(", "),
    startDate: toISODate(l.startDate),
    endDate: l.endDate ? toISODate(l.endDate) : null,
    termType: l.termType,
    rentCents: l.recurring.filter((r) => !r.endDate || r.endDate >= today).reduce((s, r) => s + r.amountCents, 0),
    balanceCents: balances.get(l.id) ?? 0,
    status: l.status,
    daysToEnd: l.endDate ? diffDays(today, l.endDate) : null,
  }));
}

export type LedgerRow = {
  id: string;
  date: string;
  type: string;
  memo: string;
  chargeKind: string | null;
  method: string | null;
  reference: string | null;
  amountCents: number;
  effectCents: number;
  balanceCents: number;
  voided: boolean;
  voidReason: string | null;
  returned: boolean;
  remainingCents: number | null;
};

/** The lease ledger with a running balance (oldest → newest), returned newest first. */
export async function ledger(ctx: AppContext, leaseId: string): Promise<LedgerRow[]> {
  const txs = await ctx.db.leaseTransaction.findMany({
    where: { leaseId },
    include: { appliedTo: { select: { amountCents: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const returned = new Set(txs.filter((t) => t.type === "RETURNED_PAYMENT" && !t.voidedAt).map((t) => t.relatedId));
  let running = 0;
  const rows = txs.map((t) => {
    const effect = balanceEffect(t);
    running += effect;
    return {
      id: t.id,
      date: toISODate(t.date),
      type: t.type,
      memo: t.memo ?? "",
      chargeKind: t.chargeKind,
      method: t.method,
      reference: t.reference,
      amountCents: t.amountCents,
      effectCents: effect,
      balanceCents: running,
      voided: Boolean(t.voidedAt),
      voidReason: t.voidReason,
      returned: returned.has(t.id),
      remainingCents: t.type === "CHARGE" && !t.voidedAt ? t.amountCents - t.appliedTo.reduce((s, a) => s + a.amountCents, 0) : null,
    };
  });
  return rows.reverse();
}

export async function listTenants(ctx: AppContext) {
  const scope = ctx.membership.propertyScope;
  const tenants = await ctx.db.tenant.findMany({
    include: {
      leases: {
        where: scope.length ? { lease: { propertyId: { in: scope } } } : {},
        include: { lease: { include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } } },
      },
    },
    orderBy: [{ lastName: "asc" }, { companyName: "asc" }],
  });
  const visible = scope.length ? tenants.filter((t) => t.leases.length > 0) : tenants;
  const leaseIds = visible.flatMap((t) => t.leases.map((l) => l.leaseId));
  const balances = await balancesBy(ctx, "leaseId", leaseIds);
  return visible.map((t) => {
    const current = t.leases.find((l) => ["ACTIVE", "EVICTION"].includes(l.lease.status)) ?? t.leases[0];
    return {
      id: t.id,
      name: tenantDisplayName(t),
      email: t.email ?? "",
      phone: t.phone ?? "",
      unit: current ? `${current.lease.property.name} · ${current.lease.units.map((u) => u.unit.name).join(", ")}` : "",
      leaseId: current?.leaseId ?? null,
      leaseStatus: current?.lease.status ?? "NO_LEASE",
      balanceCents: t.leases.reduce((s, l) => s + (balances.get(l.leaseId) ?? 0), 0),
      portalStatus: t.portalStatus,
    };
  });
}

/** Units occupied today (active/eviction lease covering today). */
export async function occupiedUnitIds(ctx: AppContext, today?: Date): Promise<Set<string>> {
  const t = today ?? (await orgToday(ctx));
  const rows = await ctx.db.leaseUnit.findMany({
    where: { lease: { status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: t }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: t } }] } },
    select: { unitId: true },
  });
  return new Set(rows.map((r) => r.unitId));
}

export type LeaseWizardOptions = Awaited<ReturnType<typeof leaseWizardOptions>>;

/** Everything the New Lease wizard needs, scoped to what the user can see. */
export async function leaseWizardOptions(ctx: AppContext) {
  const { getSettings } = await import("@/server/settings/service");
  const scope = ctx.membership.propertyScope;
  const [properties, tenants, accounts, activeLeases] = await Promise.all([
    ctx.db.property.findMany({
      where: scope.length ? { id: { in: scope } } : {},
      orderBy: { name: "asc" },
      include: { units: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, marketRentCents: true } } },
    }),
    ctx.db.tenant.findMany({ orderBy: [{ lastName: "asc" }, { companyName: "asc" }] }),
    ctx.db.account.findMany({ where: { type: "INCOME", active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, systemKey: true } }),
    ctx.db.lease.findMany({ where: { status: { in: ["ACTIVE", "EVICTION"] } }, include: { units: true } }),
  ]);
  const keys = ["lateFees.enabled", "lateFees.graceDays", "lateFees.amountCents", "tenantPortal.allowPartialPayments"] as const;
  const inherited: Record<string, Record<string, { value: unknown; source: string }>> = {};
  for (const p of properties) {
    const s = await getSettings(ctx.db, keys, { orgId: ctx.org.id, propertyId: p.id });
    inherited[p.id] = Object.fromEntries(keys.map((k) => [k, { value: s[k].value, source: s[k].source }]));
  }
  const busy: Record<string, { leaseId: string; start: string; end: string | null }[]> = {};
  for (const l of activeLeases) {
    const end = l.moveOutDate ? toISODate(l.moveOutDate) : l.termType === "FIXED" && l.endDate ? toISODate(l.endDate) : null;
    for (const u of l.units) (busy[u.unitId] ??= []).push({ leaseId: l.id, start: toISODate(l.startDate), end });
  }
  return {
    today: toISODate(await orgToday(ctx)),
    properties: properties.map((p) => ({ id: p.id, name: p.name, units: p.units })),
    tenants: tenants.map((t) => ({ id: t.id, name: tenantDisplayName(t), email: t.email })),
    incomeAccounts: accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}`, systemKey: a.systemKey })),
    rentAccountId: accounts.find((a) => a.systemKey === "RENT_INCOME")?.id ?? accounts[0]?.id ?? "",
    inherited,
    busy,
  };
}

/** Accounts for money forms (charge/credit/payment). */
export async function moneyOptions(ctx: AppContext, withLeases = false) {
  const [accounts, leases] = await Promise.all([
    ctx.db.account.findMany({ where: { active: true, type: { in: ["INCOME", "EXPENSE", "ASSET", "LIABILITY"] } }, orderBy: { code: "asc" } }),
    withLeases ? listLeases(ctx, { status: { in: ["ACTIVE", "EVICTION", "ENDED"] } }) : Promise.resolve([]),
  ]);
  const label = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
  return {
    today: toISODate(await orgToday(ctx)),
    incomeAccounts: [
      ...accounts.filter((a) => a.type === "INCOME").map((a) => ({ id: a.id, label: label(a), systemKey: a.systemKey })),
      ...accounts.filter((a) => a.systemKey === "DEPOSITS_HELD").map((a) => ({ id: a.id, label: `${label(a)} (security deposit)`, systemKey: a.systemKey })),
    ],
    creditAccounts: accounts.filter((a) => a.type === "INCOME" || a.type === "EXPENSE").map((a) => ({ id: a.id, label: label(a) })),
    bankAccounts: accounts.filter((a) => a.isBank).map((a) => ({ id: a.id, label: label(a) })),
    leases: withLeases ? leases.filter((l) => l.status !== "ENDED" || l.balanceCents !== 0).map((l) => ({ id: l.id, label: `${l.label} — ${l.tenants}`, balanceCents: l.balanceCents })) : undefined,
  };
}
