import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { getLlmProvider } from "@/adapters/llm";
import { getSmsProvider, normalizePhone, smsSegments } from "@/adapters/sms";
import { getSettings } from "@/server/settings/service";
import { tenantDisplayName } from "@/lib/leasing";
import { startOfMonth } from "@/lib/dates";

export type Party = { tenantId?: string | null; ownerId?: string | null; vendorId?: string | null; phone?: string | null };
export type Author = { userId: string | null; name: string };
export type Channel = "PORTAL" | "SMS" | "EMAIL" | "NOTE";

const personName = (p: { kind?: string; firstName?: string | null; lastName?: string | null; companyName?: string | null }) =>
  p.kind === "COMPANY" ? p.companyName ?? "" : [p.firstName, p.lastName].filter(Boolean).join(" ") || p.companyName || "";

/** Name, email and phone for whoever the conversation is with. */
export async function contactOf(db: ScopedDb, c: { tenantId: string | null; ownerId: string | null; vendorId: string | null; phone: string | null }) {
  if (c.tenantId) {
    const t = await db.tenant.findFirst({ where: { id: c.tenantId } });
    if (t) return { kind: "Tenant" as const, name: tenantDisplayName(t), email: t.email, phone: normalizePhone(t.phone), href: `/app/people/tenants/${t.id}` };
  }
  if (c.ownerId) {
    const o = await db.owner.findFirst({ where: { id: c.ownerId } });
    if (o) return { kind: "Owner" as const, name: personName(o), email: o.email, phone: normalizePhone(o.phone), href: `/app/people/owners/${o.id}` };
  }
  if (c.vendorId) {
    const v = await db.vendor.findFirst({ where: { id: c.vendorId } });
    if (v) return { kind: "Vendor" as const, name: v.name, email: v.email, phone: normalizePhone(v.phone), href: `/app/people/vendors/${v.id}` };
  }
  return { kind: "Unknown" as const, name: c.phone ?? "Unknown contact", email: null, phone: c.phone, href: null };
}

export async function findOrCreateConversation(db: ScopedDb, party: Party) {
  const where = party.tenantId ? { tenantId: party.tenantId } : party.ownerId ? { ownerId: party.ownerId } : party.vendorId ? { vendorId: party.vendorId } : party.phone ? { phone: party.phone, tenantId: null, ownerId: null, vendorId: null } : null;
  if (!where) throw new UserFacingError("Choose who to message");
  if (party.tenantId && !(await db.tenant.findFirst({ where: { id: party.tenantId } }))) throw new UserFacingError("Tenant not found");
  if (party.ownerId && !(await db.owner.findFirst({ where: { id: party.ownerId } }))) throw new UserFacingError("Owner not found");
  if (party.vendorId && !(await db.vendor.findFirst({ where: { id: party.vendorId } }))) throw new UserFacingError("Vendor not found");
  const existing = await db.conversation.findFirst({ where, orderBy: { lastMessageAt: "desc" } });
  if (existing) return existing;
  return db.conversation.create({ data: { organizationId: db.ctx.orgId, tenantId: party.tenantId ?? null, ownerId: party.ownerId ?? null, vendorId: party.vendorId ?? null, phone: party.phone ?? null } });
}

/** SMS segments sent this calendar month (metering). */
export async function smsUsage(db: ScopedDb, now = new Date()) {
  const [s, settings] = await Promise.all([
    db.message.aggregate({ where: { channel: "SMS", direction: "OUT", createdAt: { gte: startOfMonth(now) } }, _sum: { segments: true } }),
    getSettings(db, ["communications.smsEnabled", "communications.smsMonthlyLimit"], { orgId: db.ctx.orgId }),
  ]);
  return { used: s._sum.segments ?? 0, limit: settings["communications.smsMonthlyLimit"].value, enabled: settings["communications.smsEnabled"].value };
}

async function record(db: ScopedDb, conversationId: string, m: { direction: "IN" | "OUT"; channel: Channel; body: string; author: Author; status?: string; externalId?: string | null; segments?: number; error?: string | null; announcementId?: string | null; aiDrafted?: boolean }) {
  const msg = await db.message.create({
    data: {
      organizationId: db.ctx.orgId, conversationId, direction: m.direction, channel: m.channel, body: m.body, authorUserId: m.author.userId, authorName: m.author.name,
      status: m.status ?? (m.direction === "IN" ? "RECEIVED" : "SENT"), externalId: m.externalId ?? null, segments: m.segments ?? 0, error: m.error ?? null, announcementId: m.announcementId ?? null, aiDrafted: m.aiDrafted ?? false,
    },
  });
  if (m.channel !== "NOTE") {
    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: msg.createdAt, lastMessagePreview: m.body.slice(0, 140), ...(m.direction === "IN" ? { unreadCount: { increment: 1 }, status: "OPEN" } : {}) },
    });
  }
  return msg;
}

/** Send one SMS, enforcing the on/off switch, opt-outs and the monthly limit. Returns the provider result. */
async function sendSms(db: ScopedDb, to: string | null, body: string) {
  const usage = await smsUsage(db);
  if (!usage.enabled) throw new UserFacingError("Text messaging is turned off in Settings → Communications & SMS.");
  if (!to) throw new UserFacingError("This contact has no valid mobile number.");
  if (await db.smsOptOut.findFirst({ where: { phone: to } })) throw new UserFacingError("This number replied STOP and has opted out of texts.");
  const segs = smsSegments(body);
  if (usage.used + segs > usage.limit) throw new UserFacingError(`Monthly SMS limit reached (${usage.used.toLocaleString()} of ${usage.limit.toLocaleString()} segments). Raise it in Settings.`);
  return getSmsProvider().send({ to, body });
}

/** Staff → contact on the chosen channel. */
export async function sendMessage(db: ScopedDb, conversationId: string, input: { body: string; channel: Channel; author: Author; aiDrafted?: boolean }) {
  const body = input.body.trim();
  if (!body) throw new UserFacingError("Write a message", { body: "Required" });
  if (body.length > 2000) throw new UserFacingError("Keep messages under 2,000 characters", { body: "Too long" });
  const conv = await db.conversation.findFirst({ where: { id: conversationId } });
  if (!conv) throw new UserFacingError("Conversation not found");
  const contact = await contactOf(db, conv);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { name: true } });
  let msg;
  switch (input.channel) {
    case "SMS": {
      const to = contact.phone ?? conv.phone;
      const r = await sendSms(db, to, body);
      if (to && conv.phone !== to) await db.conversation.update({ where: { id: conv.id }, data: { phone: to } });
      msg = await record(db, conv.id, { direction: "OUT", channel: "SMS", body, author: input.author, status: r.status, externalId: r.externalId, segments: r.segments, error: r.error, aiDrafted: input.aiDrafted });
      if (r.status === "FAILED") throw new UserFacingError(`Text failed: ${r.error ?? "carrier error"}`);
      break;
    }
    case "EMAIL": {
      if (!contact.email) throw new UserFacingError("This contact has no email address.");
      await getEmailProvider().send({ to: contact.email, organizationId: db.ctx.orgId, subject: `Message from ${org.name}`, text: body, html: `<p style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(body)}</p><p style="color:#64748b;font-size:13px">— ${escapeHtml(input.author.name)}, ${escapeHtml(org.name)}</p>` });
      msg = await record(db, conv.id, { direction: "OUT", channel: "EMAIL", body, author: input.author, aiDrafted: input.aiDrafted });
      break;
    }
    case "PORTAL": {
      if (contact.kind !== "Tenant" && contact.kind !== "Owner") throw new UserFacingError("Portal messages are for tenants and owners. Use SMS or email.");
      msg = await record(db, conv.id, { direction: "OUT", channel: "PORTAL", body, author: input.author, aiDrafted: input.aiDrafted });
      const s = await getSettings(db, ["communications.emailOnPortalMessage"], { orgId: db.ctx.orgId });
      if (s["communications.emailOnPortalMessage"].value && contact.email) {
        const path = contact.kind === "Tenant" ? "/portal/tenant/messages" : "/portal/owner/messages";
        await getEmailProvider().send({ to: contact.email, organizationId: db.ctx.orgId, subject: `New message from ${org.name}`, text: `${input.author.name} sent you a message:\n\n${body}\n\nReply in your portal: ${process.env.AUTH_URL ?? "http://localhost:3000"}${path}`, html: `<p style="font-family:system-ui,sans-serif">${escapeHtml(input.author.name)} sent you a message:</p><blockquote style="white-space:pre-wrap">${escapeHtml(body)}</blockquote><p><a href="${process.env.AUTH_URL ?? "http://localhost:3000"}${path}">Reply in your portal</a></p>` });
      }
      break;
    }
    case "NOTE":
      msg = await record(db, conv.id, { direction: "OUT", channel: "NOTE", body, author: input.author });
      break;
  }
  await audit(db, { action: "message.sent", entityType: "Conversation", entityId: conv.id, after: { channel: input.channel, aiDrafted: input.aiDrafted ?? false } });
  return msg;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Start a thread with someone and send the first message. */
export async function startConversation(db: ScopedDb, party: Party, input: { body: string; channel: Channel; author: Author; subject?: string }) {
  const conv = await findOrCreateConversation(db, party);
  if (input.subject && !conv.subject) await db.conversation.update({ where: { id: conv.id }, data: { subject: input.subject } });
  await sendMessage(db, conv.id, input);
  return conv;
}

/** Tenant/owner → staff, from the portal. */
export async function receivePortalMessage(db: ScopedDb, party: { tenantId?: string; ownerId?: string }, body: string, author: Author) {
  const text = body.trim();
  if (!text) throw new UserFacingError("Write a message", { body: "Required" });
  if (text.length > 2000) throw new UserFacingError("Keep messages under 2,000 characters", { body: "Too long" });
  const conv = await findOrCreateConversation(db, party);
  const msg = await record(db, conv.id, { direction: "IN", channel: "PORTAL", body: text, author });
  // Portal readers have now seen everything we sent.
  await db.message.updateMany({ where: { conversationId: conv.id, direction: "OUT", readAt: null }, data: { readAt: new Date() } });
  return msg;
}

/** Inbound SMS (Twilio webhook or the /dev/sms simulator). Finds the org and contact by phone. */
export async function receiveInboundSms(input: { from: string; body: string; externalId: string; orgId?: string }) {
  const phone = normalizePhone(input.from);
  if (!phone) return { handled: false as const, reason: "bad number" };
  if (input.externalId && (await adminDb.message.findFirst({ where: { externalId: input.externalId, direction: "IN" } }))) return { handled: true as const, duplicate: true };
  let orgId = input.orgId ?? null;
  if (!orgId) {
    // System lookup: which organization texted this number most recently?
    const last = await adminDb.conversation.findFirst({ where: { phone }, orderBy: { lastMessageAt: "desc" }, select: { organizationId: true } });
    const ten = last ? null : await findContactsByPhone(phone);
    orgId = last?.organizationId ?? (ten && ten.length === 1 ? ten[0]! : null);
  }
  if (!orgId) return { handled: false as const, reason: "no matching organization" };
  const db = forOrg({ orgId, userId: null });
  const party = await partyForPhone(db, phone);
  const conv = await findOrCreateConversation(db, party);
  if (!conv.phone) await db.conversation.update({ where: { id: conv.id }, data: { phone } });
  const contact = await contactOf(db, conv);
  const word = input.body.trim().toUpperCase();
  await record(db, conv.id, { direction: "IN", channel: "SMS", body: input.body, author: { userId: null, name: contact.name }, externalId: input.externalId });
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) {
    await db.smsOptOut.upsert({ where: { organizationId_phone: { organizationId: orgId, phone } }, update: {}, create: { organizationId: orgId, phone } });
    await record(db, conv.id, { direction: "OUT", channel: "NOTE", body: "Contact opted out of texts (replied STOP).", author: { userId: null, name: "System" } });
  } else if (["START", "UNSTOP", "YES"].includes(word)) {
    await db.smsOptOut.deleteMany({ where: { phone } });
    await record(db, conv.id, { direction: "OUT", channel: "NOTE", body: "Contact opted back in to texts (replied START).", author: { userId: null, name: "System" } });
  }
  return { handled: true as const, orgId, conversationId: conv.id };
}

async function findContactsByPhone(phone: string): Promise<string[]> {
  const digits = phone.slice(-10);
  const like = { contains: digits.slice(-4) };
  const rows = [
    ...(await adminDb.tenant.findMany({ where: { phone: like, deletedAt: null }, select: { organizationId: true, phone: true } })),
    ...(await adminDb.owner.findMany({ where: { phone: like, deletedAt: null }, select: { organizationId: true, phone: true } })),
    ...(await adminDb.vendor.findMany({ where: { phone: like, deletedAt: null }, select: { organizationId: true, phone: true } })),
  ].filter((r) => normalizePhone(r.phone) === phone);
  return [...new Set(rows.map((r) => r.organizationId))];
}

async function partyForPhone(db: ScopedDb, phone: string): Promise<Party> {
  const tail = { contains: phone.slice(-4) };
  const t = (await db.tenant.findMany({ where: { phone: tail } })).find((x) => normalizePhone(x.phone) === phone);
  if (t) return { tenantId: t.id };
  const o = (await db.owner.findMany({ where: { phone: tail } })).find((x) => normalizePhone(x.phone) === phone);
  if (o) return { ownerId: o.id };
  const v = (await db.vendor.findMany({ where: { phone: tail } })).find((x) => normalizePhone(x.phone) === phone);
  if (v) return { vendorId: v.id };
  return { phone };
}

export async function markConversationRead(db: ScopedDb, conversationId: string) {
  await db.conversation.updateMany({ where: { id: conversationId }, data: { unreadCount: 0 } });
}

// ---------------------------------------------------------------- AI

/** Suggest a reply to the latest inbound message. Never sent automatically. */
export async function draftReply(db: ScopedDb, conversationId: string, staffName: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId }, include: { messages: { where: { channel: { not: "NOTE" } }, orderBy: { createdAt: "desc" }, take: 8 } } });
  if (!conv) throw new UserFacingError("Conversation not found");
  const contact = await contactOf(db, conv);
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { name: true } });
  const history = [...conv.messages].reverse().map((m) => `${m.direction === "IN" ? contact.name : m.authorName}: ${m.body}`).join("\n");
  const text = await getLlmProvider().complete({
    purpose: "draft-reply",
    system: `You draft short, friendly, professional replies for ${org.name}, a property management company. Never promise dates or amounts that aren't in the conversation. Sign as ${staffName}.`,
    messages: [{ role: "user", content: `Contact: ${contact.name} (${contact.kind})\nConversation:\n${history}\n\nDraft the next reply.` }],
    maxTokens: 300,
  });
  await audit(db, { action: "ai.draft_reply", entityType: "Conversation", entityId: conv.id });
  return text;
}

export async function improveText(db: ScopedDb, text: string, purpose: "announcement" | "message") {
  if (!text.trim()) throw new UserFacingError("Write something first");
  const out = await getLlmProvider().complete({
    purpose: "improve-text",
    system: `Rewrite this ${purpose} from a property manager so it is clear, warm and concise. Keep every fact, date and amount exactly. Return only the rewritten text.`,
    messages: [{ role: "user", content: text }],
    maxTokens: 600,
  });
  await audit(db, { action: "ai.improve_text", entityType: "Organization", entityId: db.ctx.orgId, after: { purpose } });
  return out;
}
