/**
 * Feature keys a company can be entitled to. Plans include a set; codes, purchases and the owner
 * console can add more (Entitlement rows). Checked on the server — never only in the UI.
 */
export const FEATURES = {
  "portal.tenant": "Tenant portal",
  "portal.owner": "Owner portal",
  "leases.ky": "Lease templates",
  "esign": "Built-in e-signatures",
  "accounting": "Accounting, cash & receipts",
  "maintenance": "Maintenance & vendors",
  "messaging": "Messaging (email & portal)",
  "listings": "Listings & applications",
  "utilities": "Utility bill splitting",
  "site.subdomain": "Website on a DeedWood address",
  "site.customDomain": "Website on your own domain",
  "vendors.portal": "Vendor portal",
  "reports.owner": "Owner statements & reports",
  "storage.plus": "Extra file storage",
  "sms.allowance.100": "100 text messages a month included",
  "sms.allowance.500": "500 text messages a month included",
  "api.access": "Public API",
  "support.priority": "Priority support",
  "branding.removePoweredBy": "Remove “Powered by DeedWood”",
  "storage.max": "Highest file storage",
  "support.care": "Care: priority email & assisted upgrades",
} as const;
export type FeatureKey = keyof typeof FEATURES;

const STARTER: FeatureKey[] = ["portal.tenant", "portal.owner", "leases.ky", "esign", "accounting", "maintenance", "messaging", "listings", "utilities", "site.subdomain"];
const GROWTH: FeatureKey[] = [...STARTER, "site.customDomain", "vendors.portal", "reports.owner", "storage.plus", "sms.allowance.100"];
const SCALE: FeatureKey[] = [...GROWTH, "api.access", "support.priority", "sms.allowance.500", "branding.removePoweredBy", "storage.max"];
/** Computer installs get Growth features (no hosted-only domain/storage perks). */
const LOCAL: FeatureKey[] = GROWTH.filter((f) => f !== "site.customDomain" && f !== "storage.plus");

export const PLAN_FEATURES = { STARTER, GROWTH, SCALE, LOCAL, LOCAL_CARE: [...LOCAL, "support.care"] as FeatureKey[] };
