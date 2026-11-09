/**
 * Online money movement (tenant rent payments, autopay, saved cards/banks, application fees,
 * connecting a payment processor) stays OFF until the platform owner turns it on with
 * PAYMENTS_ENABLED=1. Until then every payment screen says "coming soon" and the server refuses.
 * Cash, check and money-order payments recorded by staff always work.
 */
export const paymentsEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.PAYMENTS_ENABLED === "1" && (env.PAYMENTS_PROVIDER === "stripe" || env.NODE_ENV !== "production" || env.ENABLE_DEV_TOOLS === "1");
// ↑ In production, real money needs the real processor: with the test ("mock") provider, payments
//   stay off even if PAYMENTS_ENABLED=1, so nothing is ever marked paid without money moving.
//   (Demos and automated tests run with ENABLE_DEV_TOOLS=1.) Hosted servers also refuse to start
//   that way — see scripts/check-env.mjs.
export const PAYMENTS_COMING_SOON = "Online payments are coming soon. Until then, pay by cash, check or money order — your property manager will record it.";
