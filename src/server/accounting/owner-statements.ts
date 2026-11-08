import type { ScopedDb } from "@/server/dal";
import type { AppContext } from "@/server/context";
import { adminDb } from "@/server/db";
import { getEmailProvider } from "@/adapters";
import { runReport } from "@/server/reports/engine";
import { normalizeParams, type ReportResult } from "@/lib/reports";
import { addMonths, endOfMonth, startOfMonth, toISODate } from "@/lib/dates";
import { getSettings } from "@/server/settings/service";
import { audit } from "@/server/audit";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: unknown, kind: string) => (typeof v === "number" && kind === "money" ? `$${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v == null ? "" : String(v));

/** Statement report → a simple, email-safe HTML table. */
export function statementHtml(r: ReportResult, orgName: string, portalUrl: string) {
  const rows = r.rows.map((row) => {
    const strong = row.kind === "section" || row.kind === "total" || row.kind === "subtotal";
    const cells = r.columns.map((c, i) => `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;${i ? "text-align:right;font-variant-numeric:tabular-nums;" : ""}${strong ? "font-weight:600;" : ""}${row.kind === "section" ? "background:#f1f5f9;" : ""}">${esc(fmt(row.cells[c.key], c.kind))}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;max-width:680px">
<h2 style="margin:0 0 4px">${esc(r.title)}</h2><p style="margin:0 0 16px;color:#475569">${esc(r.subtitle)}</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${r.columns.map((c, i) => `<th style="text-align:${i ? "right" : "left"};padding:6px 8px;border-bottom:2px solid #0f766e;font-size:12px;color:#475569">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:20px"><a href="${portalUrl}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">View in your owner portal</a></p>
<p style="color:#64748b;font-size:12px">Sent by ${esc(orgName)}. Figures are cash basis for the month.</p></div>`;
}

/**
 * Nightly, on the 1st of the month: email every owner (with an email address and at least one
 * property) last month's owner statement. One send per owner per period, so re-runs are safe.
 */
export async function emailOwnerStatements(db: ScopedDb, today: Date, opts: { force?: boolean } = {}) {
  if (!opts.force && today.getUTCDate() !== 1) return 0;
  const s = await getSettings(db, ["ownerPortal.emailMonthlyStatements"], { orgId: db.ctx.orgId });
  if (!s["ownerPortal.emailMonthlyStatements"].value) return 0;
  const from = startOfMonth(addMonths(today, -1));
  const period = toISODate(from).slice(0, 7);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { name: true } });
  const owners = await db.owner.findMany({ where: { deletedAt: null, email: { not: null }, ownerships: { some: { deletedAt: null } } } });
  // A system context that can see every property (statements are computed per owner's ownerships).
  const ctx = { db, org: { id: db.ctx.orgId, name: org.name }, user: { id: "system", email: "", name: "System", preferences: {} }, membership: { propertyScope: [], roleKey: "ADMIN" }, permissions: {} } as unknown as AppContext;
  const portal = `${process.env.AUTH_URL ?? "http://localhost:3000"}/portal/owner/statements`;
  let sent = 0;
  for (const o of owners) {
    if (await db.statementSend.findFirst({ where: { ownerId: o.id, period } })) continue;
    try {
      const r = await runReport(ctx, "owner-statement", normalizeParams({ ownerId: o.id, from: toISODate(from), to: toISODate(endOfMonth(from)), basis: "CASH" }, today), today);
      const label = from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      await getEmailProvider().send({ to: o.email!, organizationId: db.ctx.orgId, subject: `Your ${label} owner statement from ${org.name}`, text: `Your ${label} owner statement is ready. View it in your owner portal: ${portal}`, html: statementHtml(r, org.name, portal) });
      await db.statementSend.create({ data: { organizationId: db.ctx.orgId, ownerId: o.id, period, email: o.email! } });
      sent++;
    } catch (e) {
      console.error("[owner statements]", o.id, e);
    }
  }
  if (sent) await audit(db, { action: "owner_statements.emailed", entityType: "Job", actorType: "SYSTEM", after: { period, sent } });
  return sent;
}
