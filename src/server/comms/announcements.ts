import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { normalizePhone } from "@/adapters/sms";
import { tenantDisplayName } from "@/lib/leasing";
import { findOrCreateConversation, sendMessage } from "./service";

export const AUDIENCE_TYPES = ["ALL_TENANTS", "PROPERTY_TENANTS", "ALL_OWNERS", "PROPERTY_OWNERS"] as const;
export type Audience = { type: (typeof AUDIENCE_TYPES)[number]; propertyIds: string[] };
export type AnnouncementInput = { title: string; body: string; audience: Audience; channels: ("PORTAL" | "EMAIL" | "SMS")[]; scheduledFor?: string | null };
export type Recipient = { key: string; tenantId?: string; ownerId?: string; name: string; email: string | null; phone: string | null };

/** Tenants on current leases (or owners) for the audience, de-duplicated. */
export async function resolveAudience(db: ScopedDb, a: Audience): Promise<Recipient[]> {
  const props = a.type.startsWith("PROPERTY_") ? a.propertyIds : null;
  if (props && !props.length) return [];
  if (a.type.endsWith("TENANTS")) {
    const links = await db.leaseTenant.findMany({
      where: { role: { in: ["PRIMARY", "COTENANT"] }, lease: { status: { in: ["ACTIVE", "EVICTION"] }, ...(props ? { propertyId: { in: props } } : {}) } },
      include: { tenant: true },
    });
    const seen = new Map<string, Recipient>();
    for (const l of links) seen.set(l.tenantId, { key: `T:${l.tenantId}`, tenantId: l.tenantId, name: tenantDisplayName(l.tenant), email: l.tenant.email, phone: normalizePhone(l.tenant.phone) });
    return [...seen.values()];
  }
  const owns = await db.propertyOwnership.findMany({ where: { deletedAt: null, ...(props ? { propertyId: { in: props } } : {}) }, include: { owner: true } });
  const seen = new Map<string, Recipient>();
  for (const o of owns) {
    const w = o.owner;
    seen.set(w.id, { key: `O:${w.id}`, ownerId: w.id, name: w.kind === "COMPANY" ? w.companyName ?? "" : [w.firstName, w.lastName].filter(Boolean).join(" "), email: w.email, phone: normalizePhone(w.phone) });
  }
  return [...seen.values()];
}

function validate(v: AnnouncementInput) {
  if (v.title.trim().length < 3) throw new UserFacingError("Give it a title", { title: "Required" });
  if (v.body.trim().length < 5) throw new UserFacingError("Write the announcement", { body: "Required" });
  if (!v.channels.length) throw new UserFacingError("Pick at least one channel", { channels: "Pick a channel" });
  if (v.audience.type.startsWith("PROPERTY_") && !v.audience.propertyIds.length) throw new UserFacingError("Choose at least one property", { audience: "Choose properties" });
  if (v.channels.includes("SMS") && v.body.length > 640) throw new UserFacingError("Text messages are limited to 640 characters (4 segments). Shorten it or untick SMS.", { body: "Too long for SMS" });
}

export async function saveAnnouncement(db: ScopedDb, id: string | null, v: AnnouncementInput, mode: "draft" | "schedule" | "send") {
  validate(v);
  const props = v.audience.propertyIds;
  if (props.length && (await db.property.count({ where: { id: { in: props } } })) !== props.length) throw new UserFacingError("Choose valid properties");
  const when = v.scheduledFor ? new Date(v.scheduledFor) : null;
  if (mode === "schedule" && (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000)) throw new UserFacingError("Pick a time in the future", { scheduledFor: "Pick a future time" });
  if (id) {
    const a = await db.announcement.findFirst({ where: { id } });
    if (!a) throw new UserFacingError("Announcement not found");
    if (a.status === "SENT") throw new UserFacingError("This announcement was already sent");
  }
  const data = { title: v.title.trim(), body: v.body.trim(), audience: v.audience, channels: v.channels, scheduledFor: mode === "schedule" ? when : null, status: mode === "schedule" ? "SCHEDULED" : "DRAFT" };
  const a = id ? await db.announcement.update({ where: { id }, data }) : await db.announcement.create({ data: { organizationId: db.ctx.orgId, createdById: db.ctx.userId, ...data } });
  await audit(db, { action: mode === "schedule" ? "announcement.scheduled" : "announcement.saved", entityType: "Announcement", entityId: a.id, after: { title: a.title, channels: a.channels, scheduledFor: a.scheduledFor } });
  if (mode === "send") return sendAnnouncement(db, a.id);
  return { id: a.id, sent: 0, failed: 0, skipped: 0 };
}

/**
 * Deliver to every recipient on every channel. Idempotent: a (recipient, channel) pair that was
 * already delivered is skipped, so a retry after a partial failure never double-sends.
 */
export async function sendAnnouncement(db: ScopedDb, id: string) {
  const a = await db.announcement.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Announcement not found");
  if (a.status === "CANCELED") throw new UserFacingError("This announcement was canceled");
  const recipients = await resolveAudience(db, a.audience as Audience);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { name: true } });
  const author = { userId: a.createdById, name: org.name };
  const done = new Set((await db.announcementDelivery.findMany({ where: { announcementId: a.id } })).map((d) => `${d.recipientKey}|${d.channel}`));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of recipients) {
    for (const ch of a.channels) {
      if (done.has(`${r.key}|${ch}`)) continue;
      let status = "SENT";
      let error: string | null = null;
      try {
        if (ch === "EMAIL") {
          if (!r.email) { status = "SKIPPED"; error = "No email address"; }
          else await getEmailProvider().send({ to: r.email, organizationId: db.ctx.orgId, subject: a.title, text: a.body, html: `<div style="font-family:system-ui,sans-serif"><h1 style="font-size:18px">${esc(a.title)}</h1><p style="white-space:pre-wrap">${esc(a.body)}</p><p style="color:#64748b;font-size:13px">${esc(org.name)}</p></div>` });
        } else if (ch === "SMS") {
          if (!r.phone) { status = "SKIPPED"; error = "No mobile number"; }
          else {
            const conv = await findOrCreateConversation(db, r.tenantId ? { tenantId: r.tenantId } : { ownerId: r.ownerId });
            const m = await sendMessage(db, conv.id, { body: `${a.title}: ${a.body}`.slice(0, 640), channel: "SMS", author });
            await db.message.update({ where: { id: m.id }, data: { announcementId: a.id } });
          }
        }
        // PORTAL: the delivery row itself is what the portal shows.
      } catch (e) {
        status = "FAILED";
        error = e instanceof Error ? e.message : "Failed";
      }
      await db.announcementDelivery.create({ data: { organizationId: db.ctx.orgId, announcementId: a.id, recipientKey: r.key, tenantId: r.tenantId ?? null, ownerId: r.ownerId ?? null, channel: ch, status, error } });
      if (status === "SENT") sent++; else if (status === "FAILED") failed++; else skipped++;
    }
  }
  await db.announcement.update({ where: { id: a.id }, data: { status: "SENT", sentAt: a.sentAt ?? new Date(), recipientCount: recipients.length } });
  await audit(db, { action: "announcement.sent", entityType: "Announcement", entityId: a.id, after: { recipients: recipients.length, sent, failed, skipped } });
  return { id: a.id, sent, failed, skipped };
}

/** Called every minute by the worker (and opportunistically): send scheduled announcements that are due. */
export async function sendDueAnnouncements(db: ScopedDb, now = new Date()) {
  const due = await db.announcement.findMany({ where: { status: "SCHEDULED", scheduledFor: { lte: now }, deletedAt: null } });
  for (const a of due) await sendAnnouncement(db, a.id);
  return due.length;
}

export async function cancelAnnouncement(db: ScopedDb, id: string) {
  const a = await db.announcement.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Announcement not found");
  if (a.status === "SENT") throw new UserFacingError("Already sent");
  await db.announcement.update({ where: { id }, data: { status: "CANCELED" } });
  await audit(db, { action: "announcement.canceled", entityType: "Announcement", entityId: id });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Announcements visible in a portal: delivered to this tenant/owner on the PORTAL channel. */
export async function portalAnnouncements(db: ScopedDb, who: { tenantId?: string; ownerId?: string }, take = 10) {
  const rows = await db.announcementDelivery.findMany({ where: { channel: "PORTAL", ...(who.tenantId ? { tenantId: who.tenantId } : { ownerId: who.ownerId }) }, include: { announcement: true }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.announcementId, title: r.announcement.title, body: r.announcement.body, sentAt: r.announcement.sentAt ?? r.createdAt }));
}
