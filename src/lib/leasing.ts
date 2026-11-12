import { z } from "zod";

/** Client-safe leasing schemas and helpers. */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const newTenantSchema = z
  .object({
    kind: z.enum(["PERSON", "COMPANY"]).default("PERSON"),
    firstName: z.string().trim().max(80).default(""),
    lastName: z.string().trim().max(80).default(""),
    companyName: z.string().trim().max(120).default(""),
    email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
    phone: z.string().trim().max(40).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "PERSON") {
      if (!v.firstName && !v.lastName) ctx.addIssue({ code: "custom", path: ["firstName"], message: "Enter a first name" });
    } else if (!v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Enter the company name" });
  });
export type NewTenantInput = z.input<typeof newTenantSchema>;

export const LEASE_ROLES = ["PRIMARY", "COTENANT", "COSIGNER"] as const;
export const ROLE_LABEL: Record<(typeof LEASE_ROLES)[number], string> = { PRIMARY: "Primary tenant", COTENANT: "Co-tenant", COSIGNER: "Cosigner" };

export const leaseTenantSchema = z.union([
  z.object({ tenantId: z.string().min(1), role: z.enum(LEASE_ROLES) }),
  z.object({ newTenant: newTenantSchema, role: z.enum(LEASE_ROLES) }),
]);

export const recurringInputSchema = z.object({
  kind: z.enum(["RENT", "OTHER"]),
  accountId: z.string().min(1, "Choose an account"),
  description: z.string().trim().min(1, "Describe the charge").max(80),
  amountCents: z.number().int().min(1, "Enter an amount"),
});

/** Lease-level overrides offered in the wizard (subset of the settings registry). */
export const LEASE_OVERRIDE_KEYS = ["lateFees.enabled", "lateFees.graceDays", "lateFees.amountCents", "tenantPortal.allowPartialPayments"] as const;

export const leaseWizardSchema = z
  .object({
    status: z.enum(["ACTIVE", "DRAFT"]).default("ACTIVE"),
    propertyId: z.string().min(1, "Choose a property"),
    unitIds: z.array(z.string().min(1)).min(1, "Choose at least one unit"),
    termType: z.enum(["FIXED", "MONTH_TO_MONTH"]).default("MONTH_TO_MONTH"),
    startDate: isoDate,
    endDate: z.union([z.literal(""), isoDate]).default(""),
    rentDueDay: z.number().int().min(1).max(28).default(1),
    tenants: z.array(leaseTenantSchema).min(1, "Add at least one tenant"),
    recurring: z.array(recurringInputSchema).default([]),
    deposit: z.object({ amountCents: z.number().int().min(0), handling: z.enum(["CHARGE", "RECEIVED", "NONE"]) }).default({ amountCents: 0, handling: "NONE" }),
    overrides: z.record(z.string(), z.unknown()).default({}),
    documents: z.enum(["NONE", "OFFLINE", "ESIGN"]).default("NONE"),
    portalInvite: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate <= v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
    const ids = v.tenants.flatMap((t) => ("tenantId" in t ? [t.tenantId] : []));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["tenants"], message: "A tenant can only be added once" });
    if (v.deposit.handling !== "NONE" && v.deposit.amountCents <= 0) ctx.addIssue({ code: "custom", path: ["deposit", "amountCents"], message: "Enter the deposit amount" });
    for (const k of Object.keys(v.overrides)) {
      if (!(LEASE_OVERRIDE_KEYS as readonly string[]).includes(k)) ctx.addIssue({ code: "custom", path: ["overrides"], message: `Unsupported override ${k}` });
    }
  });
export type LeaseWizardInput = z.input<typeof leaseWizardSchema>;

/** Do two date ranges overlap? A null end means open-ended. ISO strings compare lexicographically. */
export function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  return (bEnd === null || aStart <= bEnd) && (aEnd === null || bStart <= aEnd);
}

export const PAYMENT_METHODS = [
  { value: "CHECK", label: "Check" },
  { value: "ACH", label: "ACH / bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "MONEY_ORDER", label: "Money order" },
  { value: "OTHER", label: "Other" },
] as const;

export function tenantDisplayName(t: { kind?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
  if (t.kind === "COMPANY" && t.companyName) return t.companyName;
  return [t.firstName, t.lastName].filter(Boolean).join(" ") || t.companyName || "Unnamed tenant";
}

/** Effect of a ledger row on the tenant's balance (positive = owes more). Deposits are tracked separately. */
export function balanceEffect(t: { type: string; amountCents: number; chargeKind?: string | null; voidedAt?: Date | string | null }): number {
  if (t.voidedAt) return 0;
  switch (t.type) {
    case "CHARGE":
    case "RETURNED_PAYMENT":
      return t.amountCents;
    case "PAYMENT":
    case "CREDIT":
      return -t.amountCents;
    case "REFUND":
      return t.chargeKind === "PREPAID_REFUND" ? t.amountCents : 0;
    default:
      return 0;
  }
}

export const TX_LABEL: Record<string, string> = {
  CHARGE: "Charge",
  PAYMENT: "Payment",
  CREDIT: "Credit",
  DEPOSIT: "Deposit received",
  REFUND: "Refund",
  RETURNED_PAYMENT: "Returned payment",
};
