import type { PrismaClient } from "@prisma/client";
import type { EmailMessageInput, EmailProvider, SendResult } from "./types";

/**
 * Records every email to the EmailMessage table instead of sending it.
 * View them at /dev/outbox while developing. Zero configuration.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  constructor(private readonly db: PrismaClient) {}

  async send(msg: EmailMessageInput): Promise<SendResult> {
    const row = await this.db.emailMessage.create({
      data: {
        provider: this.name,
        to: msg.to.toLowerCase(),
        subject: msg.subject,
        html: msg.html,
        text: msg.text ?? null,
        organizationId: msg.organizationId ?? null,
      },
    });
    if (process.env.NODE_ENV !== "test") {
      console.info(`[email:mock] → ${msg.to} · ${msg.subject} (view at /dev/outbox)`);
    }
    return { id: row.id, provider: this.name };
  }
}
