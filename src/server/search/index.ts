import "server-only";
import type { AppContext } from "@/server/context";
import { can, type Module } from "@/server/permissions";
import { SETTINGS, SETTING_GROUP_LABELS } from "@/server/settings/registry";
import type { SearchResult } from "./types";

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
};

const providers: Provider[] = [
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
