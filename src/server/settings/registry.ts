import { z } from "zod";

/**
 * Every configurable setting is declared once here: its schema, default, which scopes may
 * override it, and how the Settings UI renders it. Pure module (client-safe).
 */
export type Scope = "ORG" | "PROPERTY" | "LEASE";

export type SettingInput =
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; suffix?: string }
  | { kind: "money" }
  | { kind: "percent" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "text" }
  | { kind: "color" }
  | { kind: "custom" };

export type SettingGroup =
  | "lateFees"
  | "tenantPortal"
  | "payments"
  | "applications"
  | "notifications"
  | "ownerPortal"
  | "branding"
  | "maintenance"
  | "communications";

type Def<S extends z.ZodType> = {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  schema: S;
  default: z.infer<S>;
  scopes: readonly Scope[];
  input: SettingInput;
};

function def<S extends z.ZodType>(d: Def<S>): Def<S> {
  return d;
}

const ALL: readonly Scope[] = ["ORG", "PROPERTY", "LEASE"];
const ORG_PROP: readonly Scope[] = ["ORG", "PROPERTY"];

export const SETTINGS = {
  // ── Late fees ──
  "lateFees.enabled": def({
    key: "lateFees.enabled", group: "lateFees", label: "Charge late fees",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "lateFees.graceDays": def({
    key: "lateFees.graceDays", group: "lateFees", label: "Grace period",
    help: "Days after the due date before a late fee is charged.",
    schema: z.number().int().min(0).max(31), default: 5, scopes: ALL,
    input: { kind: "number", min: 0, max: 31, suffix: "days" },
  }),
  "lateFees.type": def({
    key: "lateFees.type", group: "lateFees", label: "Fee type",
    schema: z.enum(["FLAT", "PERCENT"]), default: "FLAT", scopes: ALL,
    input: { kind: "select", options: [{ value: "FLAT", label: "Flat amount" }, { value: "PERCENT", label: "Percent of rent due" }] },
  }),
  "lateFees.amountCents": def({
    key: "lateFees.amountCents", group: "lateFees", label: "Flat fee amount",
    schema: z.number().int().min(0), default: 5000, scopes: ALL, input: { kind: "money" },
  }),
  "lateFees.percentBps": def({
    key: "lateFees.percentBps", group: "lateFees", label: "Percent of rent",
    help: "Stored in basis points (500 = 5%).",
    schema: z.number().int().min(0).max(10000), default: 500, scopes: ALL, input: { kind: "percent" },
  }),
  "lateFees.maxCents": def({
    key: "lateFees.maxCents", group: "lateFees", label: "Maximum late fees per month",
    schema: z.number().int().min(0), default: 15000, scopes: ALL, input: { kind: "money" },
  }),
  "lateFees.dailyAccrual": def({
    key: "lateFees.dailyAccrual", group: "lateFees", label: "Accrue daily after the first fee",
    schema: z.boolean(), default: false, scopes: ALL, input: { kind: "boolean" },
  }),
  "lateFees.dailyCents": def({
    key: "lateFees.dailyCents", group: "lateFees", label: "Daily fee amount",
    schema: z.number().int().min(0), default: 1000, scopes: ALL, input: { kind: "money" },
  }),

  // ── Tenant portal ──
  "tenantPortal.enabled": def({
    key: "tenantPortal.enabled", group: "tenantPortal", label: "Tenant portal access",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "tenantPortal.allowOnlinePayments": def({
    key: "tenantPortal.allowOnlinePayments", group: "tenantPortal", label: "Accept online payments",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "tenantPortal.allowPartialPayments": def({
    key: "tenantPortal.allowPartialPayments", group: "tenantPortal", label: "Allow partial payments",
    schema: z.boolean(), default: false, scopes: ALL, input: { kind: "boolean" },
  }),
  "tenantPortal.showLedger": def({
    key: "tenantPortal.showLedger", group: "tenantPortal", label: "Show ledger history",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "tenantPortal.allowRequests": def({
    key: "tenantPortal.allowRequests", group: "tenantPortal", label: "Allow maintenance requests",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "tenantPortal.requireInsurance": def({
    key: "tenantPortal.requireInsurance", group: "tenantPortal", label: "Require renters insurance",
    schema: z.boolean(), default: false, scopes: ALL, input: { kind: "boolean" },
  }),

  // ── Payments ──
  "payments.passThroughCardFee": def({
    key: "payments.passThroughCardFee", group: "payments", label: "Pass card fees to tenant",
    schema: z.boolean(), default: true, scopes: ALL, input: { kind: "boolean" },
  }),
  "payments.passThroughAchFee": def({
    key: "payments.passThroughAchFee", group: "payments", label: "Pass ACH fees to tenant",
    schema: z.boolean(), default: false, scopes: ALL, input: { kind: "boolean" },
  }),
  "payments.applicationOrder": def({
    key: "payments.applicationOrder", group: "payments", label: "Apply payments to",
    schema: z.enum(["OLDEST_FIRST", "RENT_FIRST"]), default: "OLDEST_FIRST", scopes: ALL,
    input: { kind: "select", options: [{ value: "OLDEST_FIRST", label: "Oldest open charge first" }, { value: "RENT_FIRST", label: "Rent before other charges" }] },
  }),

  // ── Rental applications ──
  "applications.feeCents": def({
    key: "applications.feeCents", group: "applications", label: "Application fee (per applicant)",
    schema: z.number().int().min(0), default: 4500, scopes: ORG_PROP, input: { kind: "money" },
  }),
  "applications.requireEmployment": def({
    key: "applications.requireEmployment", group: "applications", label: "Require employment history",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),
  "applications.requirePets": def({
    key: "applications.requirePets", group: "applications", label: "Ask about pets",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),

  // ── Notifications ──
  "notifications.rentReminderDaysBefore": def({
    key: "notifications.rentReminderDaysBefore", group: "notifications", label: "Rent reminder before due date",
    schema: z.number().int().min(0).max(14), default: 3, scopes: ALL,
    input: { kind: "number", min: 0, max: 14, suffix: "days before" },
  }),
  "notifications.rentReminderDaysAfter": def({
    key: "notifications.rentReminderDaysAfter", group: "notifications", label: "Past-due reminder after due date",
    schema: z.number().int().min(0).max(14), default: 2, scopes: ALL,
    input: { kind: "number", min: 0, max: 14, suffix: "days after" },
  }),

  // ── Owner portal ──
  "ownerPortal.enabled": def({
    key: "ownerPortal.enabled", group: "ownerPortal", label: "Owner portal access",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),
  "ownerPortal.showTenantNames": def({
    key: "ownerPortal.showTenantNames", group: "ownerPortal", label: "Show tenant names to owners",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),
  "ownerPortal.showReports": def({
    key: "ownerPortal.showReports", group: "ownerPortal", label: "Owners can run reports",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),
  "ownerPortal.showLandRecords": def({
    key: "ownerPortal.showLandRecords", group: "ownerPortal", label: "Show owners their land records",
    help: "Parcel map with lot lines, owner of record, assessed value and the deed, title and survey documents for each property they own.",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),
  "ownerPortal.approvalThresholdCents": def({
    key: "ownerPortal.approvalThresholdCents", group: "ownerPortal", label: "Owner approval for bills over",
    help: "Bills at or above this amount for a property need an owner to approve them in the owner portal before they can be paid. $0 turns this off.",
    schema: z.number().int().min(0).max(100_000_000), default: 0, scopes: ORG_PROP, input: { kind: "money" },
  }),
  "ownerPortal.emailMonthlyStatements": def({
    key: "ownerPortal.emailMonthlyStatements", group: "ownerPortal", label: "Email owners their monthly statement",
    help: "On the 1st, each owner with an email gets last month's statement (cash basis) with a link to the portal.",
    schema: z.boolean(), default: true, scopes: ["ORG"], input: { kind: "boolean" },
  }),

  // ── Communications ──
  "communications.smsEnabled": def({
    key: "communications.smsEnabled", group: "communications", label: "Text messaging (SMS)",
    help: "Send and receive texts from the inbox and announcements. Tenants can reply STOP to opt out.",
    schema: z.boolean(), default: true, scopes: ["ORG"], input: { kind: "boolean" },
  }),
  "communications.smsMonthlyLimit": def({
    key: "communications.smsMonthlyLimit", group: "communications", label: "Monthly SMS limit",
    help: "Message segments per calendar month. Sending stops at the limit so there are no surprise charges.",
    schema: z.number().int().min(0).max(100_000), default: 1000, scopes: ["ORG"], input: { kind: "number", min: 0, max: 100000, suffix: "segments" },
  }),
  "communications.emailOnPortalMessage": def({
    key: "communications.emailOnPortalMessage", group: "communications", label: "Email contacts when you reply in the portal",
    schema: z.boolean(), default: true, scopes: ["ORG"], input: { kind: "boolean" },
  }),

  // ── Maintenance ──
  "maintenance.autoAssignRules": def({
    key: "maintenance.autoAssignRules", group: "maintenance", label: "Auto-assign rules",
    help: "When a request arrives in a category, assign it to this person and/or vendor.",
    schema: z.array(z.object({ category: z.string(), userId: z.string().nullable(), vendorId: z.string().nullable() })).max(50),
    default: [] as { category: string; userId: string | null; vendorId: string | null }[], scopes: ORG_PROP, input: { kind: "custom" },
  }),
  "maintenance.notifyTenantOnUpdate": def({
    key: "maintenance.notifyTenantOnUpdate", group: "maintenance", label: "Email tenants when their request is updated",
    schema: z.boolean(), default: true, scopes: ORG_PROP, input: { kind: "boolean" },
  }),

  // ── Branding (portal theming) ──
  "branding.portalAccent": def({
    key: "branding.portalAccent", group: "branding", label: "Portal accent color",
    schema: z.string().regex(/^#[0-9a-fA-F]{6}$/), default: "#0F766E", scopes: ORG_PROP,
    input: { kind: "color" },
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  lateFees: "Late fees",
  tenantPortal: "Tenant portal",
  payments: "Payments",
  applications: "Rental applications",
  notifications: "Notifications",
  ownerPortal: "Owner portal",
  branding: "Branding",
  maintenance: "Maintenance",
  communications: "Communications & SMS",
};

export function isSettingKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, k);
}

export function settingsInGroup(group: SettingGroup): SettingKey[] {
  return (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].group === group);
}
