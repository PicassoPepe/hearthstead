import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { createLease } from "@/server/leasing/leases";
import { renderTemplate } from "@/lib/templates";
import { addDays, addMonths, parseISODate, toISODate } from "@/lib/dates";
import { tenantDisplayName } from "@/lib/leasing";
import { ensureDefaultTemplates, leaseMergeData, sendForSignature } from "./esign";

/** Suggested renewal rent: the higher of current rent + 3% and the unit's market rent, rounded to $5. */
export function suggestRenewalRent(currentCents: number, marketCents: number) {
  const bumped = Math.round((currentCents * 1.03) / 500) * 500;
  return Math.max(bumped, Math.round(marketCents / 500) * 500, currentCents);
}

/** Leases ending in the next `days` with their renewal status. */
export async function renewalCandidates(db: ScopedDb, today: Date, days = 120) {
  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE"] }, endDate: { gte: today, lte: addDays(today, days) }, moveOutDate: null },
    orderBy: { endDate: "asc" },
    include: { property: { select: { name: true } }, units: { include: { unit: { select: { name: true, marketRentCents: true } } } }, tenants: { include: { tenant: true } }, recurring: { where: { kind: "RENT", deletedAt: null } } },
  });
  const offers = await db.renewalOffer.findMany({ where: { leaseId: { in: leases.map((l) => l.id) } }, orderBy: { createdAt: "desc" } });
  return leases.map((l) => {
    const rent = l.recurring.reduce((s, r) => s + r.amountCents, 0);
    const market = l.units.reduce((s, u) => s + u.unit.marketRentCents, 0);
    const offer = offers.find((o) => o.leaseId === l.id) ?? null;
    return {
      leaseId: l.id, label: `${l.property.name} · ${l.units.map((u) => u.unit.name).join(", ")}`, tenants: l.tenants.map((t) => tenantDisplayName(t.tenant)).join(", "),
      endDate: toISODate(l.endDate!), rentCents: rent, marketCents: market, suggestedCents: suggestRenewalRent(rent, market),
      offer: offer ? { id: offer.id, status: offer.status, newRentCents: offer.newRentCents, termMonths: offer.termMonths, sentAt: offer.sentAt?.toISOString() ?? null } : null,
    };
  });
}

/** Create and send a renewal offer: the renewal addendum goes out for e-signature. Signing accepts it. */
export async function sendRenewalOffer(db: ScopedDb, input: { leaseId: string; newRentCents: number; termMonths: number; expiresInDays?: number; message?: string }, manager: { name: string; email: string }) {
  const lease = await db.lease.findFirst({ where: { id: input.leaseId }, include: { tenants: { include: { tenant: true } } } });
  if (!lease || lease.status !== "ACTIVE" || !lease.endDate) throw new UserFacingError("Only active fixed-term leases can be renewed");
  if (!Number.isSafeInteger(input.newRentCents) || input.newRentCents <= 0) throw new UserFacingError("Enter the new rent", { newRentCents: "Required" });
  if (![6, 12, 18, 24].includes(input.termMonths)) throw new UserFacingError("Choose a 6, 12, 18 or 24-month term", { termMonths: "Choose a term" });
  if (await db.renewalOffer.findFirst({ where: { leaseId: lease.id, status: "SENT" } })) throw new UserFacingError("A renewal offer is already out for this lease");
  const signers = lease.tenants.filter((t) => t.tenant.email && t.role !== "COSIGNER");
  if (!signers.length) throw new UserFacingError("Add an email address for the tenant first.");
  const startDate = addDays(lease.endDate, 1);
  const endDate = addDays(addMonths(startDate, input.termMonths), -1);
  const expiresOn = addDays(new Date(), input.expiresInDays ?? 14);
  const offer = await db.renewalOffer.create({ data: { organizationId: db.ctx.orgId, leaseId: lease.id, newRentCents: input.newRentCents, termMonths: input.termMonths, startDate, endDate, expiresOn, message: input.message ?? null, status: "SENT", sentAt: new Date(), createdById: db.ctx.userId } });
  await ensureDefaultTemplates(db);
  const tmpl = await db.documentTemplate.findFirstOrThrow({ where: { kind: "RENEWAL" }, orderBy: { isDefault: "desc" } });
  const data = await leaseMergeData(db, lease.id, { newRentCents: input.newRentCents, startDate, endDate, expiresOn });
  const { html } = renderTemplate(tmpl.body, data);
  const req = await sendForSignature(db, {
    title: `Lease renewal — ${data["property.name"]} ${data["unit.name"]}`, html: `${html}${input.message ? `<p><em>${input.message.replace(/[<>&]/g, "")}</em></p>` : ""}`,
    leaseId: lease.id, renewalOfferId: offer.id, templateId: tmpl.id,
    signers: [...signers.map((t) => ({ name: tenantDisplayName(t.tenant), email: t.tenant.email!, role: "TENANT" as const })), { name: manager.name, email: manager.email, role: "MANAGER" as const }],
  });
  await db.renewalOffer.update({ where: { id: offer.id }, data: { signatureRequestId: req.id } });
  await audit(db, { action: "renewal.sent", entityType: "Lease", entityId: lease.id, after: { newRentCents: input.newRentCents, termMonths: input.termMonths } });
  return { offerId: offer.id, signatureRequestId: req.id, links: req.links };
}

/**
 * Accept (on full signature, or staff marks it accepted): create the renewal lease starting the
 * day after the current one ends, same tenants and charges with the new rent; the current lease
 * gets a move-out date at its end. The security deposit stays held on the original lease.
 */
export async function acceptRenewal(db: ScopedDb, offerId: string, via: "signature" | "staff") {
  const offer = await db.renewalOffer.findFirst({ where: { id: offerId } });
  if (!offer) throw new UserFacingError("Offer not found");
  if (offer.status === "ACCEPTED") return offer.newLeaseId;
  if (offer.status !== "SENT") throw new UserFacingError(`This offer is ${offer.status.toLowerCase()}`);
  const lease = await db.lease.findFirstOrThrow({ where: { id: offer.leaseId }, include: { units: true, tenants: true, recurring: { where: { deletedAt: null } } } });
  const rentAcct = lease.recurring.find((r) => r.kind === "RENT")?.accountId ?? (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  await db.lease.update({ where: { id: lease.id }, data: { moveOutDate: lease.endDate, endedReason: "Renewed" } });
  const created = await createLease(db, {
    propertyId: lease.propertyId, unitIds: lease.units.map((u) => u.unitId), termType: "FIXED", startDate: toISODate(offer.startDate), endDate: toISODate(offer.endDate), rentDueDay: lease.rentDueDay,
    tenants: lease.tenants.map((t) => ({ tenantId: t.tenantId, role: t.role })),
    recurring: [
      { kind: "RENT", accountId: rentAcct, description: "Rent", amountCents: offer.newRentCents },
      ...lease.recurring.filter((r) => r.kind !== "RENT").map((r) => ({ kind: r.kind, accountId: r.accountId, description: r.description, amountCents: r.amountCents })),
    ],
    deposit: { amountCents: 0, handling: "NONE" },
  }, new Date());
  await db.renewalOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED", respondedAt: new Date(), newLeaseId: created.id } });
  await audit(db, { action: "renewal.accepted", entityType: "Lease", entityId: lease.id, after: { via, newLeaseId: created.id } });
  return created.id;
}

export async function setRenewalStatus(db: ScopedDb, offerId: string, status: "DECLINED" | "WITHDRAWN") {
  const offer = await db.renewalOffer.findFirst({ where: { id: offerId } });
  if (!offer || offer.status !== "SENT") throw new UserFacingError("Only open offers can be changed");
  await db.renewalOffer.update({ where: { id: offerId }, data: { status, respondedAt: new Date() } });
  if (offer.signatureRequestId) await db.signatureRequest.updateMany({ where: { id: offer.signatureRequestId, status: "SENT" }, data: { status: "VOIDED" } });
  await audit(db, { action: `renewal.${status.toLowerCase()}`, entityType: "RenewalOffer", entityId: offerId });
}

/** Nightly: expire offers past their date. */
export async function expireRenewalOffers(db: ScopedDb, today: Date) {
  const r = await db.renewalOffer.updateMany({ where: { status: "SENT", expiresOn: { lt: today } }, data: { status: "EXPIRED" } });
  return r.count;
}

export { parseISODate };
