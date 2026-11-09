/** A reply we can store. Pure parsing — no database, no network. */
export type InboundEmail = { from: string; subject: string; text: string; externalId: string; resendEmailId: string | null };

function addressOf(from: string): string {
  const wrapped = from.match(/<([^>]+)>/);
  return (wrapped?.[1] ?? from).trim();
}

/**
 * Accepts either a Resend `email.received` event or a small JSON body from a Cloudflare
 * Email Routing worker: `{ from, subject, text, messageId }`.
 */
export function parseInboundEmail(body: unknown, fallbackId: string): InboundEmail | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const data = row.type === "email.received" && row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
  const from = typeof data.from === "string" ? addressOf(data.from) : "";
  if (!from.includes("@")) return null;
  const subject = typeof data.subject === "string" ? data.subject : "";
  const text = typeof data.text === "string" ? data.text : typeof data.html === "string" ? data.html : "";
  const resendEmailId = typeof data.email_id === "string" ? data.email_id : null;
  const messageId = typeof data.messageId === "string" ? data.messageId : typeof data.message_id === "string" ? data.message_id : null;
  return { from, subject, text, externalId: messageId || resendEmailId || fallbackId, resendEmailId };
}
