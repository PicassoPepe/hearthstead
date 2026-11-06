import "server-only";
import { adminDb } from "@/server/db";
import { MockEmailProvider } from "./email/mock";
import { SmtpEmailProvider } from "./email/smtp";
import type { EmailProvider } from "./email/types";

/**
 * Adapter registry. Each third-party integration is selected by an env var and defaults to a
 * working mock, so the app runs locally with zero API keys. See README "Adapters".
 */
let email: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (email) return email;
  const kind = process.env.EMAIL_PROVIDER ?? "mock";
  email =
    kind === "smtp"
      ? new SmtpEmailProvider(process.env.SMTP_URL ?? "smtp://localhost:1025", process.env.EMAIL_FROM ?? "no-reply@localhost", adminDb)
      : new MockEmailProvider(adminDb);
  return email;
}

export const ADAPTERS = [
  { name: "EmailProvider", env: "EMAIL_PROVIDER", implementations: ["mock", "smtp"], phase: 1 },
  { name: "PaymentsProvider", env: "PAYMENTS_PROVIDER", implementations: ["mock", "stripe"], phase: 4 },
  { name: "SmsProvider", env: "SMS_PROVIDER", implementations: ["mock", "twilio"], phase: 8 },
  { name: "ScreeningProvider", env: "SCREENING_PROVIDER", implementations: ["mock"], phase: 9 },
  { name: "ESignProvider", env: "ESIGN_PROVIDER", implementations: ["builtin"], phase: 9 },
  { name: "BankFeedProvider", env: "BANKFEED_PROVIDER", implementations: ["mock", "plaid"], phase: 6 },
  { name: "ListingFeedProvider", env: "LISTINGFEED_PROVIDER", implementations: ["file"], phase: 9 },
  { name: "AccountingExportProvider", env: "ACCOUNTING_EXPORT_PROVIDER", implementations: ["csv", "quickbooks"], phase: 10 },
  { name: "InsuranceProvider", env: "INSURANCE_PROVIDER", implementations: ["mock"], phase: 4 },
  { name: "StorageProvider", env: "STORAGE_PROVIDER", implementations: ["local", "s3"], phase: 2 },
  { name: "LlmProvider", env: "LLM_PROVIDER", implementations: ["mock", "anthropic"], phase: 10 },
] as const;
