import nodemailer, { type Transporter } from "nodemailer";
import type { PrismaClient } from "@prisma/client";
import type { EmailMessageInput, EmailProvider, SendResult } from "./types";

/** SMTP provider (Mailpit locally, or any SMTP relay such as Resend's SMTP endpoint). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transport: Transporter;
  constructor(url: string, private readonly from: string, private readonly db: PrismaClient) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(msg: EmailMessageInput): Promise<SendResult> {
    const info = await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    await this.db.emailMessage.create({
      data: { provider: this.name, to: msg.to.toLowerCase(), subject: msg.subject, html: msg.html, text: msg.text ?? null, organizationId: msg.organizationId ?? null },
    });
    return { id: String(info.messageId), provider: this.name };
  }
}
