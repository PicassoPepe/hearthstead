import "server-only";
import type { AppContext } from "@/server/context";
import { can, type Module } from "@/server/permissions";
import { SETTINGS, SETTING_GROUP_LABELS } from "@/server/settings/registry";
import type { SearchResult } from "./types";
import { ownerDisplayName, PROPERTY_TYPE_META } from "@/lib/rentals";
import { propertyScopeWhere } from "@/server/rentals/service";
import { tenantDisplayName } from "@/lib/leasing";

/**
 * Global search registry. Each phase registers a provider for its entities (properties,
 * units, leases, tenants...). Providers run in parallel, are permission-gated, and every
 * query goes through the tenant-scoped db.
 */
type Provider = { module?: Module; search: (ctx: AppContext, q: string) => Promise<SearchResult[]> };

const GROUP_HREF: Record<string, string> = {
  lateFees: "/app/settings/late-fees",
  tenantPortal: "/app/settings/tenant-portal",
  payments: "/app/settings/payments",
  applications: "/app/settings/applications",
  notifications: "/app/settings/notifications",
  ownerPortal: "/app/settings/owner-portal",
  branding: "/app/settings",
  maintenance: "/app/settings/maintenance",
};

const providers: Provider[] = [
  {
    module: "people",
    async search(ctx, q) {
      const scope = ctx.membership.propertyScope;
      const rows = await ctx.db.tenant.findMany({
        where: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { companyName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
          ...(scope.length ? { leases: { some: { lease: { propertyId: { in: scope } } } } } : {}),
        },
        include: { leases: { where: { lease: { status: { in: ["ACTIVE", "EVICTION"] } } }, include: { lease: { include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } } } }, take: 1 } },
        take: 6,
      });
      return rows.map((t) => {
        const l = t.leases[0]?.lease;
        return { id: `tenant:${t.id}`, type: "tenant", group: "Tenants", title: tenantDisplayName(t), subtitle: l ? `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}` : (t.email ?? "Tenant"), href: `/app/people/tenants/${t.id}` };
      });
    },
  },
  {
    module: "rentals",
    async search(ctx, q) {
      const rows = await ctx.db.property.findMany({
        where: {
          ...propertyScopeWhere(ctx.membership.propertyScope),
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { addressLine1: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
            { postalCode: { startsWith: q } },
          ],
        },
        take: 6,
        orderBy: { name: "asc" },
      });
      return rows.map((p) => ({
        id: `property:${p.id}`, type: "property", group: "Properties", title: p.name,
        subtitle: `${PROPERTY_TYPE_META[p.type].label} · ${p.addressLine1}, ${p.city}`, href: `/app/rentals/${p.id}`,
      }));
    },
  },
  {
    module: "rentals",
    async search(ctx, q) {
      const scope = ctx.membership.propertyScope;
      const rows = await ctx.db.unit.findMany({
        where: {
          property: { deletedAt: null, ...(scope.length ? { id: { in: scope } } : {}) },
          OR: [{ name: { contains: q, mode: "insensitive" } }, { property: { name: { contains: q, mode: "insensitive" } } }],
        },
        include: { property: { select: { name: true } } },
        take: 6,
      });
      return rows.map((u) => ({ id: `unit:${u.id}`, type: "unit", group: "Units", title: `${u.property.name} · ${u.name}`, href: `/app/rentals/units/${u.id}` }));
    },
  },
  {
    module: "people",
    async search(ctx, q) {
      const rows = await ctx.db.owner.findMany({
        where: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { companyName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 6,
      });
      return rows.map((o) => ({ id: `owner:${o.id}`, type: "owner", group: "Owners", title: ownerDisplayName(o), subtitle: o.email ?? "Owner", href: `/app/people/owners/${o.id}` }));
    },
  },
  {
    module: "users",
    async search(ctx, q) {
      const rows = await ctx.db.membership.findMany({
        where: { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } },
        include: { user: true, role: true },
        take: 6,
      });
      return rows.map((m) => ({
        id: `user:${m.id}`,
        type: "user",
        group: "Team",
        title: m.user.name ?? m.user.email,
        subtitle: `${m.role.name} · ${m.user.email}`,
        href: `/app/settings/users?member=${m.id}`,
      }));
    },
  },
  {
    module: "settings",
    async search(_ctx, q) {
      const needle = q.toLowerCase();
      return Object.values(SETTINGS)
        .filter((d) => d.label.toLowerCase().includes(needle) || SETTING_GROUP_LABELS[d.group].toLowerCase().includes(needle))
        .slice(0, 6)
        .map((d) => ({
          id: `setting:${d.key}`,
          type: "setting",
          group: "Settings",
          title: d.label,
          subtitle: SETTING_GROUP_LABELS[d.group],
          href: GROUP_HREF[d.group] ?? "/app/settings",
        }));
    },
  },
];

export async function globalSearch(ctx: AppContext, q: string): Promise<SearchResult[]> {
  const query = q.trim().slice(0, 100);
  if (query.length < 2) return [];
  const active = providers.filter((p) => !p.module || can(ctx.permissions, p.module, "view"));
  const settled = await Promise.allSettled(active.map((p) => p.search(ctx, query)));
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}
