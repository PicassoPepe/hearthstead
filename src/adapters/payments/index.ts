import { MockPaymentsProvider } from "./mock";
import { StripePaymentsProvider } from "./stripe";
import type { PaymentsProvider } from "./types";

let provider: PaymentsProvider | undefined;

/** PAYMENTS_PROVIDER=mock (default) | stripe (needs STRIPE_SECRET_KEY). */
export function getPaymentsProvider(): PaymentsProvider {
  if (provider) return provider;
  provider =
    process.env.PAYMENTS_PROVIDER === "stripe" && process.env.STRIPE_SECRET_KEY
      ? new StripePaymentsProvider(process.env.STRIPE_SECRET_KEY, process.env.AUTH_URL ?? "http://localhost:3000")
      : new MockPaymentsProvider();
  return provider;
}

export * from "./types";
