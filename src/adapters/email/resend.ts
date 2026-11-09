import type { PrismaClient } from "@prisma/client";
import type { EmailMessageInput, EmailProvider, SendResult } from "./types";

type SendFetch = (url: string, init: RequestInit) => Promise<Response>;
let sendFetch: SendFetch = (url, init) => fetch(url, init);
/** Tests replace the HTTP call. */
export function setResendFetch(f: SendFetch) { sendFetch = f; }

/**
 * Outbound email through Resend's HTTPS API. Workers cannot rely on SMTP.
 * The message is also stored in EmailMessage, same as the mock and SMTP providers.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private readonly apiKey: string, private readonly from: string, private readonly db: PrismaClient) {}

  async send(msg: EmailMessageInput): Promise<SendResult> {
    const res = await sendFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status})`);
    const json = (await res.json()) as { id?: string };
    await this.db.emailMessage.create({
      data: { provider: this.name, to: msg.to.toLowerCase(), subject: msg.subject, html: msg.html, text: msg.text ?? null, organizationId: msg.organizationId ?? null },
    });
    return { id: json.id ?? "resend", provider: this.name };
  }
}
