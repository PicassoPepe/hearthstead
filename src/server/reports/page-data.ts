import type { AppContext } from "@/server/context";
import { orgToday } from "@/server/leasing/queries";
import { normalizeParams, reportDefaults, reportMeta, type ReportKey } from "@/lib/reports";
import { toISODate } from "@/lib/dates";
import { runReport } from "./engine";

/** Shared by the viewer and the print page: resolve params, run the report, load filter options. */
export async function loadReport(ctx: AppContext, key: string, sp: Record<string, string | undefined>) {
  const meta = reportMeta(key);
  if (!meta) return null;
  const today = await orgToday(ctx);
  const params = normalizeParams({ ...reportDefaults(key, today), ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) }, today);
  const scope = ctx.membership.propertyScope;
  const [report, properties, portfolios, accounts, owners] = await Promise.all([
    runReport(ctx, key as ReportKey, params, today),
    ctx.db.property.findMany({ where: scope.length ? { id: { in: scope } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.portfolio.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    meta.params.includes("account") ? ctx.db.account.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    meta.params.includes("owner") ? ctx.db.owner.findMany({ where: { ownerships: { some: {} } }, orderBy: [{ lastName: "asc" }, { companyName: "asc" }], select: { id: true, kind: true, firstName: true, lastName: true, companyName: true } }) : Promise.resolve([]),
  ]);
  return {
    meta, params, report, today: toISODate(today),
    options: {
      properties, portfolios: scope.length ? [] : portfolios,
      accounts: accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
      owners: owners.map((o) => ({ id: o.id, name: o.kind === "COMPANY" ? o.companyName ?? "Owner" : [o.firstName, o.lastName].filter(Boolean).join(" ") })),
    },
  };
}
