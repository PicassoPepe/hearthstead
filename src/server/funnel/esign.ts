import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { getESignProvider } from "@/adapters/esign";
import { getStorage } from "@/adapters/storage";
import { DEFAULT_TEMPLATES, renderTemplate, type MergeData } from "@/lib/templates";
import { formatDate, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { tenantDisplayName } from "@/lib/leasing";

const BASE = () => process.env.AUTH_URL ?? "http://localhost:3000";
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

/** Make sure the org has the starter templates (idempotent). */
export async function ensureDefaultTemplates(db: ScopedDb) {
  if (await db.documentTemplate.count()) return;
  await db.documentTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ organizationId: db.ctx.orgId, name: t.name, kind: t.kind, body: t.body, isDefault: true })) });
}

/** Merge data for a lease (and optional renewal offer). */
export async function leaseMergeData(db: ScopedDb, leaseId: string, renewal?: { newRentCents: number; startDate: Date; endDate: Date; expiresOn: Date | null }): Promise<MergeData> {
  const lease = await db.lease.findFirst({
    where: { id: leaseId },
    include: { property: true, units: { include: { unit: true } }, tenants: { include: { tenant: true } }, recurring: { where: { kind: "RENT", deletedAt: null } } },
  });
  if (!lease) throw new UserFacingError("Lease not found");
  const org = await db.organization.findFirstOrThrow({ where: { id: db.ctx.orgId } });
  const signers = lease.tenants.filter((t) => t.role !== "COSIGNER");
  const rent = lease.recurring.reduce((s, r) => s + r.amountCents, 0);
  const late = await db.setting.findMany({ where: { key: { in: ["lateFees.amountCents", "lateFees.graceDays"] }, scope: "ORG" } });
  const lateAmt = late.find((s) => s.key === "lateFees.amountCents")?.value as number | undefined;
  const grace = late.find((s) => s.key === "lateFees.graceDays")?.value as number | undefined;
  return {
    "company.name": org.name, "company.phone": org.phone ?? "", "company.email": org.email ?? "", today: formatDate(new Date()),
    "tenant.names": signers.map((t) => tenantDisplayName(t.tenant)).join(", "), "tenant.email": signers[0]?.tenant.email ?? "",
    "property.name": lease.property.name, "property.address": `${lease.property.addressLine1}, ${lease.property.city}, ${lease.property.state} ${lease.property.postalCode}`,
    "unit.name": lease.units.map((u) => u.unit.name).join(", "),
    "lease.start": formatDate(lease.startDate), "lease.end": lease.endDate ? formatDate(lease.endDate) : "month-to-month",
    "lease.rent": formatMoney(rent), "lease.deposit": formatMoney(lease.depositCents), "lease.dueDay": ordinal(lease.rentDueDay),
    "lease.lateFee": lateAmt !== undefined ? `${formatMoney(lateAmt)} after ${grace ?? 5} days` : "per company policy",
    ...(renewal ? { "renewal.rent": formatMoney(renewal.newRentCents), "renewal.start": formatDate(renewal.startDate), "renewal.end": formatDate(renewal.endDate), "renewal.expires": renewal.expiresOn ? formatDate(renewal.expiresOn) : "" } : {}),
  };
}

export type SignerInput = { name: string; email: string; role: "TENANT" | "COSIGNER" | "MANAGER" };

/**
 * Freeze the rendered document, hash it, create one-time signing links, and email them.
 * Tenants sign first (order 1), the manager countersigns (order 2).
 */
export async function sendForSignature(db: ScopedDb, input: { title: string; html: string; signers: SignerInput[]; leaseId?: string | null; renewalOfferId?: string | null; templateId?: string | null }) {
  if (!input.signers.length) throw new UserFacingError("Add at least one signer");
  for (const s of input.signers) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) throw new UserFacingError(`${s.name || "A signer"} needs a valid email address`);
  const esign = getESignProvider();
  const tokens: { signerIdx: number; token: string }[] = [];
  const req = await db.signatureRequest.create({
    data: {
      organizationId: db.ctx.orgId, title: input.title, documentHtml: input.html, documentHash: esign.hashDocument(input.html), leaseId: input.leaseId ?? null, renewalOfferId: input.renewalOfferId ?? null, templateId: input.templateId ?? null, createdById: db.ctx.userId,
      signers: {
        create: input.signers.map((s, i) => {
          const t = esign.issueToken();
          tokens.push({ signerIdx: i, token: t.token });
          return { organizationId: db.ctx.orgId, name: s.name, email: s.email.toLowerCase(), role: s.role, order: s.role === "MANAGER" ? 2 : 1, tokenHash: t.hash };
        }),
      },
      events: { create: { organizationId: db.ctx.orgId, event: "SENT" } },
    },
  });
  const org = await db.organization.findFirstOrThrow({ where: { id: db.ctx.orgId } });
  for (const { signerIdx, token } of tokens) {
    const s = input.signers[signerIdx]!;
    if (s.role === "MANAGER") continue; // emailed once the tenants have signed
    await emailSigner(db, org.name, input.title, s, token);
  }
  // Keep manager tokens retrievable only via a fresh link issued at countersign time.
  await audit(db, { action: "esign.sent", entityType: "SignatureRequest", entityId: req.id, after: { title: input.title, signers: input.signers.map((s) => s.email) } });
  return { id: req.id, links: tokens.map((t) => ({ email: input.signers[t.signerIdx]!.email, url: `${BASE()}/sign/${t.token}` })) };
}

async function emailSigner(db: ScopedDb, orgName: string, title: string, s: { name: string; email: string }, token: string) {
  const url = `${BASE()}/sign/${token}`;
  await getEmailProvider().send({
    to: s.email, organizationId: db.ctx.orgId, subject: `Please sign: ${title}`,
    text: `${orgName} sent you "${title}" to sign: ${url}`,
    html: `<div style="font-family:system-ui,sans-serif"><p>Hi ${s.name.split(" ")[0]},</p><p>${orgName} sent you <strong>${title}</strong> to review and sign electronically.</p><p style="margin:24px 0"><a href="${url}" style="background:#0F766E;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; sign</a></p><p style="color:#64748b;font-size:13px">This link is just for you — please don't forward it.</p></div>`,
  });
}

/** System lookup of a signer by the raw token in their link (no session). */
export async function signerByToken(token: string) {
  const hash = getESignProvider().hashToken(token);
  const s = await adminDb.signer.findUnique({ where: { tokenHash: hash }, include: { request: { include: { signers: { orderBy: { order: "asc" } } } } } });
  if (!s) return null;
  return { signer: s, request: s.request, db: forOrg({ orgId: s.organizationId, userId: null }) };
}

export async function recordView(token: string, meta: { ip: string | null; ua: string | null }) {
  const r = await signerByToken(token);
  if (!r || r.signer.status !== "PENDING") return r;
  await r.db.signer.update({ where: { id: r.signer.id }, data: { status: "VIEWED" } });
  await r.db.signatureEvent.create({ data: { organizationId: r.signer.organizationId, requestId: r.request.id, signerId: r.signer.id, event: "VIEWED", ip: meta.ip, userAgent: meta.ua } });
  return r;
}

/** Sign: typed full name must match the signer's name; order is enforced (manager last). */
export async function signDocument(token: string, typedName: string, meta: { ip: string | null; ua: string | null }) {
  const r = await signerByToken(token);
  if (!r) throw new UserFacingError("This signing link is invalid or has expired.");
  const { signer, request, db } = r;
  if (request.status !== "SENT") throw new UserFacingError(`This document is ${request.status.toLowerCase()}.`);
  if (signer.status === "SIGNED") throw new UserFacingError("You've already signed.");
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm(typedName) !== norm(signer.name)) throw new UserFacingError(`Type your full name exactly as shown: ${signer.name}`, { name: "Doesn't match" });
  if (request.signers.some((s) => s.order < signer.order && s.status !== "SIGNED")) throw new UserFacingError("Waiting for the other signers first.");
  await db.signer.update({ where: { id: signer.id }, data: { status: "SIGNED", signedName: typedName.trim(), signedAt: new Date(), ip: meta.ip, userAgent: meta.ua } });
  await db.signatureEvent.create({ data: { organizationId: signer.organizationId, requestId: request.id, signerId: signer.id, event: "SIGNED", ip: meta.ip, userAgent: meta.ua } });
  const all = await db.signer.findMany({ where: { requestId: request.id } });
  const org = await db.organization.findFirstOrThrow({ where: { id: signer.organizationId } });
  // Tenants done → invite the manager to countersign (fresh token).
  const pendingTenants = all.filter((s) => s.order === 1 && s.status !== "SIGNED");
  const manager = all.find((s) => s.role === "MANAGER" && s.status !== "SIGNED");
  if (!pendingTenants.length && manager && signer.role !== "MANAGER") {
    const t = getESignProvider().issueToken();
    await db.signer.update({ where: { id: manager.id }, data: { tokenHash: t.hash } });
    await emailSigner(db, org.name, request.title, manager, t.token);
  }
  if (all.every((s) => s.status === "SIGNED")) await completeRequest(db, request.id);
  return { completed: all.every((s) => s.status === "SIGNED") };
}

export async function declineToSign(token: string, reason: string, meta: { ip: string | null; ua: string | null }) {
  const r = await signerByToken(token);
  if (!r) throw new UserFacingError("This signing link is invalid.");
  await r.db.signer.update({ where: { id: r.signer.id }, data: { status: "DECLINED" } });
  await r.db.signatureRequest.update({ where: { id: r.request.id }, data: { status: "DECLINED" } });
  await r.db.signatureEvent.create({ data: { organizationId: r.signer.organizationId, requestId: r.request.id, signerId: r.signer.id, event: `DECLINED${reason ? `: ${reason.slice(0, 200)}` : ""}`, ip: meta.ip, userAgent: meta.ua } });
}

/** Store the signed document + certificate (audit trail) as an attachment on the lease. */
async function completeRequest(db: ScopedDb, requestId: string) {
  const req = await db.signatureRequest.findFirstOrThrow({ where: { id: requestId }, include: { signers: true, events: { orderBy: { createdAt: "asc" } } } });
  const cert = `<hr/><h2>Certificate of completion</h2><p>Document: ${req.title}<br/>SHA-256: <code>${req.documentHash}</code><br/>Completed: ${new Date().toISOString()}</p>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Signer</th><th>Role</th><th>Signed as</th><th>Signed at (UTC)</th><th>IP</th><th>Device</th></tr>
${req.signers.map((s) => `<tr><td>${s.name} &lt;${s.email}&gt;</td><td>${s.role}</td><td>${s.signedName ?? ""}</td><td>${s.signedAt?.toISOString() ?? ""}</td><td>${s.ip ?? ""}</td><td>${(s.userAgent ?? "").slice(0, 80)}</td></tr>`).join("")}</table>
<h3>Audit trail</h3><ul>${req.events.map((e) => `<li>${e.createdAt.toISOString()} — ${e.event}${e.signerId ? ` (${req.signers.find((s) => s.id === e.signerId)?.email ?? ""})` : ""}${e.ip ? ` · ${e.ip}` : ""}</li>`).join("")}</ul>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${req.title}</title><style>body{font-family:Georgia,serif;max-width:760px;margin:32px auto;line-height:1.5;color:#0f172a}code{font-size:12px;word-break:break-all}</style></head><body>${req.documentHtml}<h2>Signatures</h2>${req.signers.map((s) => `<p><em style="font-size:20px;font-family:cursive">${s.signedName}</em><br/>${s.name} (${s.role.toLowerCase()}) — ${s.signedAt ? formatDate(s.signedAt) : ""}</p>`).join("")}${cert}</body></html>`;
  const key = `${req.organizationId}/esign/${req.id}.html`;
  await getStorage().put(key, Buffer.from(html), "text/html");
  const att = await db.attachment.create({ data: { organizationId: req.organizationId, entityType: req.leaseId ? "Lease" : null, entityId: req.leaseId, name: `${req.title} (signed ${toISODate(new Date())}).html`, contentType: "text/html", sizeBytes: Buffer.byteLength(html), storageKey: key, category: "Lease" } });
  await db.signatureRequest.update({ where: { id: req.id }, data: { status: "COMPLETED", completedAt: new Date(), finalAttachmentId: att.id } });
  await db.signatureEvent.create({ data: { organizationId: req.organizationId, requestId: req.id, event: "COMPLETED" } });
  if (req.renewalOfferId) {
    const { acceptRenewal } = await import("./renewals");
    await acceptRenewal(db, req.renewalOfferId, "signature");
  }
  await audit(db, { action: "esign.completed", entityType: "SignatureRequest", entityId: req.id, actorType: "SYSTEM" });
  const { notifyModule } = await import("@/server/notifications/service");
  await notifyModule(db, "leasing", { kind: "signature", title: "Document fully signed", body: req.title, href: req.leaseId ? `/app/leasing/${req.leaseId}?tab=files` : "/app/files?tab=signatures" });
}

export async function voidSignatureRequest(db: ScopedDb, id: string) {
  const r = await db.signatureRequest.findFirst({ where: { id } });
  if (!r) throw new UserFacingError("Not found");
  if (r.status !== "SENT") throw new UserFacingError("Only in-progress requests can be voided");
  await db.signatureRequest.update({ where: { id }, data: { status: "VOIDED" } });
  await db.signatureEvent.create({ data: { organizationId: db.ctx.orgId, requestId: id, event: "VOIDED" } });
  await audit(db, { action: "esign.voided", entityType: "SignatureRequest", entityId: id });
}

/** Lease → e-sign: render a template with lease data; tenants sign, then the sender countersigns. */
export async function sendLeaseForSignature(db: ScopedDb, leaseId: string, templateId: string | null, manager: { name: string; email: string }) {
  await ensureDefaultTemplates(db);
  const tmpl = templateId ? await db.documentTemplate.findFirst({ where: { id: templateId } }) : await db.documentTemplate.findFirst({ where: { kind: "LEASE" }, orderBy: { isDefault: "desc" } });
  if (!tmpl) throw new UserFacingError("Choose a template");
  const data = await leaseMergeData(db, leaseId);
  const { html, missing } = renderTemplate(tmpl.body, data);
  const lease = await db.lease.findFirstOrThrow({ where: { id: leaseId }, include: { tenants: { include: { tenant: true } } } });
  const tenants = lease.tenants.filter((t) => t.tenant.email);
  if (!tenants.length) throw new UserFacingError("Add an email address to at least one tenant first.");
  const r = await sendForSignature(db, {
    title: `${tmpl.name} — ${data["property.name"]} ${data["unit.name"]}`, html, leaseId, templateId: tmpl.id,
    signers: [...tenants.map((t) => ({ name: tenantDisplayName(t.tenant), email: t.tenant.email!, role: (t.role === "COSIGNER" ? "COSIGNER" : "TENANT") as SignerInput["role"] })), { name: manager.name, email: manager.email, role: "MANAGER" }],
  });
  return { ...r, missing };
}
