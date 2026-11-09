/**
 * PaymentsProvider adapter. Implementations: MockPaymentsProvider (default, zero keys) and
 * StripePaymentsProvider (Stripe Connect Express + Financial Connections).
 */
export type AccountResult = { externalId: string; status: "PENDING" | "ACTIVE" | "RESTRICTED"; chargesEnabled: boolean; payoutsEnabled: boolean; onboardingUrl?: string; payoutBankMask?: string };
export type CardInput = { number: string; expMonth: number; expYear: number; cvc: string } | { token: string };
export type BankInput = { routingNumber: string; accountNumber: string; holderName: string } | { financialConnectionsAccount: string };
export type SavedMethod = { providerRef: string; type: "CARD" | "ACH"; brand?: string; bankName?: string; last4: string; expMonth?: number; expYear?: number; verified: boolean };
export type ChargeInput = {
  connectedAccount: string;
  methodType: "CARD" | "ACH";
  methodRef: string;
  /** What the tenant is charged in total (rent amount + convenience fee). */
  totalCents: number;
  feeCents: number;
  idempotencyKey: string;
  description: string;
  /** Processor customer the saved method belongs to (Stripe: needed to reuse a saved card/bank). */
  customerRef?: string | null;
};
export type ChargeResult = { providerRef: string; status: "SUCCEEDED" | "PROCESSING" | "FAILED"; failureReason?: string };

export interface PaymentsProvider {
  readonly name: string;
  createAccount(orgName: string, email: string | null): Promise<AccountResult>;
  refreshAccount(externalId: string): Promise<AccountResult>;
  addCard(input: CardInput): Promise<SavedMethod>;
  verifyBank(input: BankInput): Promise<SavedMethod>;
  charge(input: ChargeInput): Promise<ChargeResult>;
  /** Stripe: start saving a card or bank in the browser (Payment Element + SetupIntent). */
  startSetup?(input: { customerRef: string | null; name: string; email: string | null; idempotencyKey: string }): Promise<{ customerRef: string; clientSecret: string }>;
  /** Stripe: read back what the browser saved. Throws unless the setup finished. */
  methodFromSetup?(setupIntentId: string): Promise<SavedMethod & { customerRef: string }>;
  /** Mock only: decide how a pending ACH settles. Real providers report this by webhook. */
  settle?(providerRef: string): Promise<"SUCCEEDED" | "FAILED">;
}

export class PaymentDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentDeclinedError";
  }
}
