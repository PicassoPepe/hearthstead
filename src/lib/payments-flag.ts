/**
 * Online money movement (tenant rent payments, autopay, saved cards/banks, application fees,
 * connecting a payment processor) stays OFF until the platform owner turns it on with
 * PAYMENTS_ENABLED=1. Until then every payment screen says "coming soon" and the server refuses.
 * Cash, check and money-order payments recorded by staff always work.
 */
export const paymentsEnabled = () => process.env.PAYMENTS_ENABLED === "1";
export const PAYMENTS_COMING_SOON = "Online payments are coming soon. Until then, pay by cash, check or money order — your property manager will record it.";
