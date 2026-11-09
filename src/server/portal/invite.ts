import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { tenantDisplayName } from "@/lib/leasing";

const APP = process.env.NEXT_PUBLIC_APP_NAME ?? "DeedWood";

/** Create (or reuse) a login for the tenant, link it, and email a portal sign-in link. */
export async function inviteTenantToPortal(db: ScopedDb, tenantId: string, orgName: string): Promise<{ email: string }> {
  const t = await db.tenant.findFirst({ where: { id: tenantId } });
  if (!t) throw new UserFacingError("Tenant not found");
  if (!t.email) throw new UserFacingError(`${tenantDisplayName(t)} has no email address. Add one first.`);
  const email = t.email.toLowerCase();
  // Users are global identities (system lookup), the link is tenant data (scoped).
  const user = (await adminDb.user.findUnique({ where: { email } })) ?? (await adminDb.user.create({ data: { email, name: tenantDisplayName(t) } }));
  const link = await db.tenantUser.findFirst({ where: { tenantId, userId: user.id, deletedAt: undefined } });
  if (!link) await db.tenantUser.create({ data: { organizationId: db.ctx.orgId, tenantId, userId: user.id, createdById: db.ctx.userId } });
  else if (link.deletedAt) await db.tenantUser.update({ where: { id: link.id }, data: { deletedAt: null, invitedAt: new Date() } });
  if (t.portalStatus !== "ACTIVE") await db.tenant.update({ where: { id: tenantId }, data: { portalStatus: "INVITED" } });

  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  const url = `${base}/login?email=${encodeURIComponent(email)}&portal=1&callbackUrl=${encodeURIComponent("/portal/tenant")}`;
  await getEmailProvider().send({
    to: email,
    organizationId: db.ctx.orgId,
    subject: `${orgName} invited you to the resident portal`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a"><h1 style="font-size:20px">Pay rent and request repairs online</h1><p>${orgName} uses ${APP} for rent payments, autopay, maintenance requests and documents.</p><p style="margin:24px 0"><a href="${url}" style="background:#0C4C54;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open your portal</a></p><p style="color:#475569;font-size:13px">We'll email you a one-time sign-in link — no password needed.</p></body></html>`,
    text: `${orgName} invited you to the resident portal: ${url}`,
  });
  await audit(db, { action: "tenant.portal_invited", entityType: "Tenant", entityId: tenantId, after: { email } });
  return { email };
}

/** Create (or reuse) a login for an owner, link it, and email an owner-portal sign-in link. */
export async function inviteOwnerToPortal(db: ScopedDb, ownerId: string, orgName: string): Promise<{ email: string }> {
  const o = await db.owner.findFirst({ where: { id: ownerId } });
  if (!o) throw new UserFacingError("Owner not found");
  const name = o.kind === "COMPANY" ? o.companyName ?? "Owner" : [o.firstName, o.lastName].filter(Boolean).join(" ");
  if (!o.email) throw new UserFacingError(`${name} has no email address. Add one first.`);
  const email = o.email.toLowerCase();
  const user = (await adminDb.user.findUnique({ where: { email } })) ?? (await adminDb.user.create({ data: { email, name } }));
  const link = await db.ownerUser.findFirst({ where: { ownerId, userId: user.id, deletedAt: undefined } });
  if (!link) await db.ownerUser.create({ data: { organizationId: db.ctx.orgId, ownerId, userId: user.id, createdById: db.ctx.userId } });
  else if (link.deletedAt) await db.ownerUser.update({ where: { id: link.id }, data: { deletedAt: null, invitedAt: new Date() } });
  if (o.portalStatus !== "ACTIVE") await db.owner.update({ where: { id: ownerId }, data: { portalStatus: "INVITED" } });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  const url = `${base}/login?email=${encodeURIComponent(email)}&portal=1&callbackUrl=${encodeURIComponent("/portal/owner")}`;
  await getEmailProvider().send({
    to: email,
    organizationId: db.ctx.orgId,
    subject: `${orgName} invited you to the owner portal`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a"><h1 style="font-size:20px">See how your properties are doing</h1><p>${orgName} uses ${APP} to share statements, income, distributions and documents with owners.</p><p style="margin:24px 0"><a href="${url}" style="background:#0C4C54;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open the owner portal</a></p></body></html>`,
    text: `${orgName} invited you to the owner portal: ${url}`,
  });
  await audit(db, { action: "owner.portal_invited", entityType: "Owner", entityId: ownerId, after: { email } });
  return { email };
}
