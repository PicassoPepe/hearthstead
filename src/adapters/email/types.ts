export type EmailMessageInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  organizationId?: string | null;
};

export type SendResult = { id: string; provider: string };

/** Adapter interface. Implementations: MockEmailProvider (default), SmtpEmailProvider. */
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessageInput): Promise<SendResult>;
}
