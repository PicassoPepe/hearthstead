import "server-only";
import { paymentsEnabled } from "@/lib/payments-flag";
import type { PortalContext } from "./context";
import * as M from "@/server/leasing/money";
import { portalSettings } from "@/server/payments/service";
import { ledger } from "@/server/leasing/queries";
import { addMonths, startOfMonth, toISODate, utcDate } from "@/lib/dates";

/** Everything the portal home needs for the selected lease — always filtered to this tenant. */
export async function portalHome(ctx: PortalContext) {
  if (!ctx.lease) return null;
  const leaseId = ctx.lease.id;
  const [lease, bal, settings, autopay, methods, payments, account] = await Promise.all([
    ctx.db.lease.findFirstOrThrow({ where: { id: leaseId }, include: { recurring: { where: { deletedAt: null } } } }),
    ctx.db.tx((tx) => M.leaseBalance(tx, leaseId)),
    portalSettings(ctx.db, ctx.lease),
    ctx.db.autopay.findFirst({ where: { leaseId, tenantId: ctx.tenant.id, active: true } }),
    ctx.db.paymentMethod.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
    ctx.db.paymentIntent.findMany({ where: { leaseId, tenantId: ctx.tenant.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    ctx.db.processorAccount.findFirst(),
  ]);
  const rentCents = lease.recurring.filter((r) => !r.endDate || r.endDate >= ctx.today).reduce((s, r) => s + r.amountCents, 0);
  const thisDue = utcDate(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), lease.rentDueDay);
  const nextDue = thisDue >= ctx.today ? thisDue : utcDate(startOfMonth(addMonths(ctx.today, 1)).getUTCFullYear(), startOfMonth(addMonths(ctx.today, 1)).getUTCMonth(), lease.rentDueDay);
  const autopayMethod = autopay ? methods.find((m) => m.id === autopay.paymentMethodId) : null;
  return {
    balanceCents: bal.balanceCents,
    rentCents,
    nextDue: lease.status === "ENDED" ? null : toISODate(nextDue),
    settings,
    paymentsReady: paymentsEnabled() && Boolean(account?.chargesEnabled) && settings.allowOnlinePayments,
    paymentsComingSoon: !paymentsEnabled(),
    autopay: autopay ? { dayOfMonth: autopay.dayOfMonth, amountMode: autopay.amountMode, fixedCents: autopay.fixedCents, method: autopayMethod ? `${autopayMethod.type === "CARD" ? autopayMethod.brand : autopayMethod.bankName} ••${autopayMethod.last4}` : "?", paymentMethodId: autopay.paymentMethodId } : null,
    methods: methods.map((m) => ({ id: m.id, type: m.type as "CARD" | "ACH", label: `${m.type === "CARD" ? (m.brand ?? "Card") : (m.bankName ?? "Bank")} ••${m.last4}`, detail: m.type === "CARD" ? `Expires ${String(m.expMonth).padStart(2, "0")}/${String(m.expYear).slice(-2)}` : m.verified ? "Verified" : "Not verified", isDefault: m.isDefault, verified: m.verified })),
    recentPayments: payments.map((p) => ({ id: p.id, amountCents: p.amountCents, status: p.status, methodType: p.methodType, date: toISODate(p.initiatedOn), origin: p.origin })),
  };
}

export async function portalLedger(ctx: PortalContext) {
  if (!ctx.lease) return [];
  return (await ledger({ db: ctx.db } as never, ctx.lease.id)).filter((r) => !r.voided);
}

/** Readable color for the org's brand: fall back to the default teal if contrast with white < 4.5:1. */
export function accessibleBrand(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#0C4C54";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return 1.05 / (lum + 0.05) >= 4.5 ? hex : "#0C4C54";
}
