import { randomUUID } from "node:crypto";
import { cardBrand, luhn } from "@/lib/payments";
import { PaymentDeclinedError, type AccountResult, type BankInput, type CardInput, type ChargeInput, type ChargeResult, type PaymentsProvider, type SavedMethod } from "./types";

/**
 * Offline processor that behaves like Stripe's test mode:
 *   - cards: 4242 4242 4242 4242 succeeds; 4000 0000 0000 0002 is declined; any other valid
 *     Luhn number succeeds.
 *   - ACH: routing 110000000. Account numbers ending in 0002 verify but fail at settlement
 *     (like an NSF); everything else settles successfully.
 * Method refs encode the behavior, so settlement is deterministic and needs no state.
 */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = "mock";

  async createAccount(): Promise<AccountResult> {
    return { externalId: `acct_mock_${randomUUID().slice(0, 12)}`, status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true, payoutBankMask: "6789" };
  }

  async refreshAccount(externalId: string): Promise<AccountResult> {
    return { externalId, status: "ACTIVE", chargesEnabled: true, payoutsEnabled: true, payoutBankMask: "6789" };
  }

  async addCard(input: CardInput): Promise<SavedMethod> {
    if ("token" in input) return { providerRef: `pm_mock_card_${input.token}`, type: "CARD", brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030, verified: true };
    const num = input.number.replace(/\D/g, "");
    if (!luhn(num)) throw new PaymentDeclinedError("That card number isn't valid.");
    const now = new Date();
    if (input.expYear < now.getUTCFullYear() || (input.expYear === now.getUTCFullYear() && input.expMonth < now.getUTCMonth() + 1)) throw new PaymentDeclinedError("That card has expired.");
    if (!/^\d{3,4}$/.test(input.cvc)) throw new PaymentDeclinedError("Check the security code.");
    const behavior = num === "4000000000000002" ? "decline" : "ok";
    return { providerRef: `pm_mock_card_${behavior}_${randomUUID().slice(0, 8)}`, type: "CARD", brand: cardBrand(num), last4: num.slice(-4), expMonth: input.expMonth, expYear: input.expYear, verified: true };
  }

  async verifyBank(input: BankInput): Promise<SavedMethod> {
    if ("financialConnectionsAccount" in input) return { providerRef: `pm_mock_ach_ok_${input.financialConnectionsAccount}`, type: "ACH", bankName: "Mock Bank", last4: "6789", verified: true };
    if (!/^\d{9}$/.test(input.routingNumber)) throw new PaymentDeclinedError("Routing numbers have 9 digits.");
    if (!/^\d{4,17}$/.test(input.accountNumber)) throw new PaymentDeclinedError("Check the account number.");
    const behavior = input.accountNumber.endsWith("0002") ? "nsf" : "ok";
    return { providerRef: `pm_mock_ach_${behavior}_${randomUUID().slice(0, 8)}`, type: "ACH", bankName: input.routingNumber === "110000000" ? "Test Bank" : "Community Bank", last4: input.accountNumber.slice(-4), verified: true };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const providerRef = `pi_mock_${input.methodType === "ACH" ? (input.methodRef.includes("_nsf_") ? "nsf" : "ok") : "card"}_${randomUUID().slice(0, 12)}`;
    if (input.methodType === "CARD") {
      if (input.methodRef.includes("_decline_")) return { providerRef, status: "FAILED", failureReason: "Your card was declined." };
      return { providerRef, status: "SUCCEEDED" };
    }
    return { providerRef, status: "PROCESSING" };
  }

  async settle(providerRef: string): Promise<"SUCCEEDED" | "FAILED"> {
    return providerRef.startsWith("pi_mock_nsf_") ? "FAILED" : "SUCCEEDED";
  }
}
