import type { Lease, LeaseTransaction, Property, Task, Tenant, Unit } from "@prisma/client";

/** Database rows → public API objects (snake_case, cents, ISO dates). Never leaks internal fields. */
const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);

export const property = (p: Property & { _count?: { units: number } }) => ({
  id: p.id, object: "property" as const, name: p.name, type: p.type,
  address: { line1: p.addressLine1, line2: p.addressLine2, city: p.city, state: p.state, postal_code: p.postalCode, country: p.country },
  portfolio_id: p.portfolioId, unit_count: p._count?.units ?? 0, created_at: p.createdAt.toISOString(),
});

export const unit = (u: Unit, occupied: boolean) => ({
  id: u.id, object: "unit" as const, property_id: u.propertyId, name: u.name, beds: u.beds, baths: u.bathsTenths !== null ? u.bathsTenths / 10 : null, sqft: u.sqft, market_rent: u.marketRentCents, occupied,
});

export const tenant = (t: Tenant) => ({
  id: t.id, object: "tenant" as const, first_name: t.firstName, last_name: t.lastName, company_name: t.companyName, email: t.email, phone: t.phone, portal_status: t.portalStatus, created_at: t.createdAt.toISOString(),
});

export const lease = (l: Lease & { units: { unitId: string }[]; tenants: { tenantId: string }[]; recurring: { kind: string; amountCents: number }[] }) => ({
  id: l.id, object: "lease" as const, property_id: l.propertyId, unit_ids: l.units.map((u) => u.unitId), tenant_ids: l.tenants.map((t) => t.tenantId), status: l.status,
  start_date: d(l.startDate)!, end_date: d(l.endDate), move_out_date: d(l.moveOutDate), rent: l.recurring.filter((r) => r.kind === "RENT").reduce((s, r) => s + r.amountCents, 0), deposit: l.depositCents, created_at: l.createdAt.toISOString(),
});

export const transaction = (t: LeaseTransaction) => ({
  id: t.id, object: "transaction" as const, lease_id: t.leaseId, type: t.type, amount: t.amountCents, date: d(t.date)!, due_date: d(t.dueDate), memo: t.memo, method: t.method, voided: Boolean(t.voidedAt),
});

export const task = (t: Task) => ({
  id: t.id, object: "task" as const, number: t.number, type: t.type, status: t.status, priority: t.priority, title: t.title, description: t.description, category: t.category,
  property_id: t.propertyId, unit_id: t.unitId, due_date: d(t.dueDate), created_at: t.createdAt.toISOString(),
});
