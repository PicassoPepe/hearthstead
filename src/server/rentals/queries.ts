import "server-only";
import type { AppContext } from "@/server/context";
import { ownerDisplayName } from "@/lib/rentals";
import { propertyScopeWhere } from "./service";
import { balancesBy, occupiedUnitIds } from "@/server/leasing/queries";

/** Read models for rentals pages. All go through the tenant-scoped db and member property scope. */

export async function wizardOptions(ctx: AppContext) {
  const [portfolios, banks, owners] = await Promise.all([
    ctx.db.portfolio.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.account.findMany({ where: { isBank: true, active: true }, include: { bankAccount: true }, orderBy: { code: "asc" } }),
    ctx.db.owner.findMany({ orderBy: [{ lastName: "asc" }, { companyName: "asc" }] }),
  ]);
  return {
    orgId: ctx.org.id,
    portfolios,
    bankAccounts: banks.map((b) => ({
      id: b.id,
      label: `${b.code} · ${b.name}${b.bankAccount?.mask ? ` (••${b.bankAccount.mask})` : ""}`,
      purpose: b.bankAccount?.purpose ?? "OPERATING",
      systemKey: b.systemKey,
    })),
    owners: owners.map((o) => ({ id: o.id, name: ownerDisplayName(o) })),
  };
}

export type PropertyRow = {
  id: string;
  name: string;
  type: string;
  address: string;
  city: string;
  portfolio: string;
  portfolioId: string | null;
  units: number;
  occupied: number;
  owners: string;
  marketRentCents: number;
  balanceCents: number;
};

export async function listProperties(ctx: AppContext): Promise<PropertyRow[]> {
  const rows = await ctx.db.property.findMany({
    where: propertyScopeWhere(ctx.membership.propertyScope),
    include: {
      portfolio: { select: { name: true } },
      units: { where: { deletedAt: null }, select: { id: true, marketRentCents: true } },
      ownerships: { where: { deletedAt: null }, include: { owner: true }, orderBy: { percentBps: "desc" } },
    },
    orderBy: { name: "asc" },
  });
  const [occupied, balances] = await Promise.all([occupiedUnitIds(ctx), balancesBy(ctx, "propertyId", rows.map((p) => p.id))]);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    address: `${p.addressLine1}, ${p.city}, ${p.state}`,
    city: p.city,
    portfolio: p.portfolio?.name ?? "",
    portfolioId: p.portfolioId,
    units: p.units.length,
    occupied: p.units.filter((u) => occupied.has(u.id)).length,
    balanceCents: balances.get(p.id) ?? 0,
    owners: p.ownerships.map((o) => ownerDisplayName(o.owner)).join(", "),
    marketRentCents: p.units.reduce((s, u) => s + u.marketRentCents, 0),
  }));
}

export type UnitRow = {
  id: string;
  name: string;
  propertyId: string;
  propertyName: string;
  beds: number | null;
  bathsTenths: number | null;
  sqft: number | null;
  marketRentCents: number;
  status: "VACANT" | "OCCUPIED";
  isListed: boolean;
};

export async function listUnits(ctx: AppContext, propertyId?: string): Promise<UnitRow[]> {
  const scope = ctx.membership.propertyScope;
  const units = await ctx.db.unit.findMany({
    where: {
      ...(propertyId ? { propertyId } : {}),
      property: { deletedAt: null, ...(scope.length ? { id: { in: scope } } : {}) },
    },
    include: { property: { select: { name: true } } },
    orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
  });
  const occupied = await occupiedUnitIds(ctx);
  return units.map((u) => ({
    id: u.id,
    name: u.name,
    propertyId: u.propertyId,
    propertyName: u.property.name,
    beds: u.beds,
    bathsTenths: u.bathsTenths,
    sqft: u.sqft,
    marketRentCents: u.marketRentCents,
    status: occupied.has(u.id) ? "OCCUPIED" : "VACANT",
    isListed: u.isListed,
  }));
}

export async function listOwners(ctx: AppContext) {
  const owners = await ctx.db.owner.findMany({
    include: { ownerships: { where: { deletedAt: null, property: { deletedAt: null } }, include: { property: { select: { name: true } } } } },
    orderBy: [{ lastName: "asc" }, { companyName: "asc" }],
  });
  return owners.map((o) => ({
    id: o.id,
    name: ownerDisplayName(o),
    kind: o.kind,
    email: o.email ?? "",
    phone: o.phone ?? "",
    properties: o.ownerships.length,
    propertyNames: o.ownerships.map((x) => x.property.name).join(", "),
    portalStatus: o.portalStatus,
  }));
}
