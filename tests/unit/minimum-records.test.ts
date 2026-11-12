import { describe, expect, it } from "vitest";
import { leaseWizardSchema, newTenantSchema } from "@/lib/leasing";
import { propertyWizardSchema, unitInputSchema } from "@/lib/rentals";

describe("minimum records", () => {
  it("a property needs a name or an address and never a bank account", () => {
    expect(propertyWizardSchema.safeParse({ type: "MULTI_FAMILY", name: "Maple" }).success).toBe(true);
    expect(propertyWizardSchema.safeParse({ type: "MULTI_FAMILY", name: "", address: { addressLine1: "1 Oak St" } }).success).toBe(true);
    const saved = propertyWizardSchema.parse({ type: "MULTI_FAMILY", name: "Maple" });
    expect(saved.defaultOperatingAccountId ?? null).toBeNull();
    expect(saved.defaultDepositAccountId ?? null).toBeNull();
    expect(saved.units).toEqual([]);
  });

  it("a unit needs only a label", () => {
    expect(unitInputSchema.parse({ name: "A" })).toMatchObject({ name: "A", marketRentCents: 0 });
    expect(unitInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("a tenant needs only a name", () => {
    expect(newTenantSchema.safeParse({ firstName: "Sam" }).success).toBe(true);
    expect(newTenantSchema.safeParse({ lastName: "Ng" }).success).toBe(true);
    expect(newTenantSchema.safeParse({ kind: "COMPANY", companyName: "Ng LLC" }).success).toBe(true);
    expect(newTenantSchema.safeParse({ kind: "PERSON" }).success).toBe(false);
  });

  it("a lease needs a unit, a tenant and a start date — not rent, a deposit or e-sign", () => {
    const parsed = leaseWizardSchema.safeParse({
      propertyId: "prop",
      unitIds: ["unit"],
      startDate: "2026-12-01",
      tenants: [{ newTenant: { firstName: "Sam" }, role: "COTENANT" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.recurring).toEqual([]);
    expect(parsed.data.deposit).toEqual({ amountCents: 0, handling: "NONE" });
    expect(parsed.data.documents).toBe("NONE");
    expect(parsed.data.tenants[0]?.role).toBe("COTENANT");
    expect(leaseWizardSchema.safeParse({ propertyId: "prop", startDate: "2026-12-01", tenants: [{ newTenant: { firstName: "Sam" }, role: "PRIMARY" }] }).success).toBe(false);
  });
});
