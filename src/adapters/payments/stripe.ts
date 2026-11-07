import type { AccountResult, BankInput, CardInput, ChargeInput, ChargeResult, PaymentsProvider, SavedMethod } from "./types";
import { PaymentDeclinedError } from "./types";

/**
 * Stripe Connect (Express) implementation using Stripe's REST API directly (no SDK).
 * Card and bank details must be tokenized client-side with Stripe Elements / Financial
 * Connections; this adapter only ever receives Stripe ids (pm_…, fca_…), never raw numbers.
 * Requires STRIPE_SECRET_KEY; webhooks are verified with STRIPE_WEBHOOK_SECRET.
 */
export class StripePaymentsProvider implements PaymentsProvider {
  readonly name = "stripe";
  constructor(private readonly secretKey: string, private readonly appUrl: string) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, string>, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new PaymentDeclinedError(json.error?.message ?? `Stripe error ${res.status}`);
    return json;
  }

  private toAccount(a: { id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }, onboardingUrl?: string): AccountResult {
    return {
      externalId: a.id,
      status: a.charges_enabled ? "ACTIVE" : a.details_submitted ? "RESTRICTED" : "PENDING",
      chargesEnabled: a.charges_enabled,
      payoutsEnabled: a.payouts_enabled,
      onboardingUrl,
    };
  }

  async createAccount(orgName: string, email: string | null): Promise<AccountResult> {
    const acct = await this.call<{ id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }>("POST", "/accounts", {
      type: "express",
      "business_profile[name]": orgName,
      ...(email ? { email } : {}),
      "capabilities[card_payments][requested]": "true",
      "capabilities[us_bank_account_ach_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
    });
    const link = await this.call<{ url: string }>("POST", "/account_links", {
      account: acct.id,
      type: "account_onboarding",
      refresh_url: `${this.appUrl}/app/settings/payments`,
      return_url: `${this.appUrl}/app/settings/payments?onboarded=1`,
    });
    return this.toAccount(acct, link.url);
  }

  async refreshAccount(externalId: string): Promise<AccountResult> {
    return this.toAccount(await this.call("GET", `/accounts/${externalId}`));
  }

  async addCard(input: CardInput): Promise<SavedMethod> {
    if (!("token" in input)) throw new PaymentDeclinedError("Card details must be collected with Stripe Elements.");
    const pm = await this.call<{ id: string; card: { brand: string; last4: string; exp_month: number; exp_year: number } }>("GET", `/payment_methods/${input.token}`);
    return { providerRef: pm.id, type: "CARD", brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year, verified: true };
  }

  async verifyBank(input: BankInput): Promise<SavedMethod> {
    if (!("financialConnectionsAccount" in input)) throw new PaymentDeclinedError("Bank accounts must be linked with Stripe Financial Connections.");
    const pm = await this.call<{ id: string; us_bank_account: { bank_name: string; last4: string } }>("POST", "/payment_methods", {
      type: "us_bank_account",
      "us_bank_account[financial_connections_account]": input.financialConnectionsAccount,
    });
    return { providerRef: pm.id, type: "ACH", bankName: pm.us_bank_account.bank_name, last4: pm.us_bank_account.last4, verified: true };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const pi = await this.call<{ id: string; status: string; last_payment_error?: { message: string } }>(
      "POST",
      "/payment_intents",
      {
        amount: String(input.totalCents),
        currency: "usd",
        payment_method: input.methodRef,
        "payment_method_types[]": input.methodType === "ACH" ? "us_bank_account" : "card",
        confirm: "true",
        description: input.description,
        application_fee_amount: String(input.feeCents),
        "transfer_data[destination]": input.connectedAccount,
      },
      input.idempotencyKey,
    );
    const status = pi.status === "succeeded" ? "SUCCEEDED" : pi.status === "processing" ? "PROCESSING" : "FAILED";
    return { providerRef: pi.id, status, failureReason: pi.last_payment_error?.message };
  }
}
