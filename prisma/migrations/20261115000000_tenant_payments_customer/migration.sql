-- Stripe customer per tenant (saved cards/banks are attached to it).
ALTER TABLE "Tenant" ADD COLUMN "paymentsCustomerRef" TEXT;
