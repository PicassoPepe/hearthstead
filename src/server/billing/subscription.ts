import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { DEFAULT_PLANS, hostedPlanFor } from "@/lib/pricing";
import { stripe } from "./stripe-client";

/**
 * A company's DeedWood subscription. New companies get a 14-day trial; the platform owner can make
 * any company free ("comped" — beta/partner) with a reason and optional end date. Stripe Checkout
 * starts a paid plan; Stripe's webhooks keep the status in sync. Data is never deleted for
 * non-payment — at most the company becomes read-only (only when BILLING_ENFORCED=1).
 */
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = Number(process.env.BILLING_GRACE_DAYS ?? 3);

export async function getSubscription(orgId: string) {
  const s = await adminDb.subscription.findUnique({ where: { orgId } });
  if (s) return s;
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId }, select: { createdAt: true } });
  return adminDb.subscription.upsert({ where: { orgId }, update: {}, create: { orgId, status: "TRIALING", trialEndsAt: new Date(org.createdAt.getTime() + TRIAL_DAYS * 86_400_000) } });
}

export type BillingState = "comped" | "trial" | "trial_ended" | "active" | "past_due" | "read_only" | "canceled";

/** What the subscription means right now. */
export function billingState(s: { status: string; trialEndsAt: Date | null; compUntil: Date | null; pastDueSince: Date | null; currentPeriodEnd: Date | null }, now = new Date()): { state: BillingState; daysLeft?: number } {
  const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));
  if (s.status === "COMPLIMENTARY" || s.status === "BETA") return s.compUntil && s.compUntil <= now ? { state: "trial_ended" } : { state: "comped", ...(s.compUntil ? { daysLeft: days(s.compUntil) } : {}) };
  if (s.status === "ACTIVE") return { state: "active" };
  if (s.status === "TRIALING") return s.trialEndsAt && s.trialEndsAt <= now ? { state: "trial_ended" } : { state: "trial", ...(s.trialEndsAt ? { daysLeft: days(s.trialEndsAt) } : {}) };
  if (s.status === "PAST_DUE") {
    const graceEnds = new Date((s.pastDueSince ?? now).getTime() + GRACE_DAYS * 86_400_000);
    return graceEnds <= now ? { state: "read_only" } : { state: "past_due", daysLeft: days(graceEnds) };
  }
  if (s.status === "CANCELED") return s.currentPeriodEnd && s.currentPeriodEnd > now ? { state: "active" } : { state: "canceled" };
  return { state: "read_only" };
}

/** Should this company be read-only for billing reasons? Only when enforcement is switched on. */
export async function billingReadOnly(orgId: string, now = new Date()) {
  if (process.env.BILLING_ENFORCED !== "1" || process.env.DEEDWOOD_DEPLOYMENT === "LOCAL") return false;
  const { state } = billingState(await getSubscription(orgId), now);
  return state === "trial_ended" || state === "read_only" || state === "canceled";
}

/** The banner across the top of the staff app, for hosted companies (only once billing is enforced). */
export async function hostedBillingNotice(orgId: string, now = new Date()): Promise<{ message: string; readOnly: boolean } | null> {
  if (process.env.BILLING_ENFORCED !== "1" || process.env.DEEDWOOD_DEPLOYMENT === "LOCAL") return null;
  const { state, daysLeft } = billingState(await getSubscription(orgId), now);
  if (state === "trial" && daysLeft != null && daysLeft <= 3) return { message: `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Choose a plan to keep going.`, readOnly: false };
  if (state === "past_due") return { message: `Your last payment didn't go through. Update your card within ${daysLeft} day${daysLeft === 1 ? "" : "s"} to avoid read-only mode.`, readOnly: false };
  if (state === "trial_ended" || state === "read_only" || state === "canceled") return { message: "Your account is read-only until you choose a plan. Nothing has been deleted.", readOnly: true };
  return null;
}

export async function setComp(orgId: string, v: { reason: string; until: Date | null; kind?: "COMPLIMENTARY" | "BETA" }) {
  await getSubscription(orgId);
  return adminDb.subscription.update({ where: { orgId }, data: { status: v.kind ?? "BETA", compReason: v.reason, compUntil: v.until, pastDueSince: null } });
}
export async function endComp(orgId: string, now = new Date()) {
  const s = await getSubscription(orgId);
  return adminDb.subscription.update({ where: { orgId }, data: { status: s.stripeSubscriptionId ? "ACTIVE" : "TRIALING", compReason: null, compUntil: null, ...(s.stripeSubscriptionId ? {} : { trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000) }) } });
}

// ─── Stripe Checkout & portal ─────────────────────────────────────────────────

/** Stripe price lookup keys (see STRIPE_SANDBOX.md) and the minimum quantity that covers the plan's floor. */
export function stripeLine(planKey: string, interval: "month" | "year", units: number) {
  const p = DEFAULT_PLANS.find((x) => x.key === planKey);
  if (!p) throw new UserFacingError("Pick a plan");
  const u = Math.max(1, Math.floor(units));
  switch (planKey) {
    case "hosted_starter": return { lookupKey: interval === "year" ? "starter_yearly" : "starter_monthly", quantity: 1 };
    case "hosted_growth": if (interval !== "month") throw new UserFacingError("Growth is billed monthly"); return { lookupKey: "growth_unit_monthly", quantity: Math.max(u, Math.ceil((p.monthlyMinCents ?? 0) / (p.monthlyPerUnitCents ?? 1))) };
    case "hosted_scale": if (interval !== "month") throw new UserFacingError("Scale is billed monthly"); return { lookupKey: "scale_unit_monthly", quantity: Math.max(u, Math.ceil((p.monthlyMinCents ?? 0) / (p.monthlyPerUnitCents ?? 1))) };
    case "local_annual": return { lookupKey: "local_unit_yearly", quantity: Math.max(u, Math.ceil((p.annualMinCents ?? 0) / (p.annualPerUnitCents ?? 1))) };
    default: throw new UserFacingError("That plan can't be bought online yet");
  }
}

async function priceId(lookupKey: string) {
  const r = await stripe<{ data: { id: string }[] }>("GET", "/prices", { lookup_keys: [lookupKey], active: "true" });
  if (!r.data[0]) throw new UserFacingError("That price isn't set up in Stripe yet.");
  return r.data[0].id;
}

async function ensureCustomer(orgId: string, email: string) {
  const s = await getSubscription(orgId);
  if (s.stripeCustomerId) return s.stripeCustomerId;
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: orgId } });
  const c = await stripe<{ id: string }>("POST", "/customers", { name: org.name, email, metadata: { orgId } }, `cust-${orgId}`);
  await adminDb.subscription.update({ where: { orgId }, data: { stripeCustomerId: c.id } });
  return c.id;
}

export async function startCheckout(v: { orgId: string; email: string; planKey: string; interval: "month" | "year"; units: number; appUrl: string; care?: boolean }) {
  const line = stripeLine(v.planKey, v.interval, v.units);
  const items: { price: string; quantity: number }[] = [{ price: await priceId(line.lookupKey), quantity: line.quantity }];
  if (v.care && v.planKey === "local_annual") items.push({ price: await priceId("local_care_yearly"), quantity: 1 });
  const customer = await ensureCustomer(v.orgId, v.email);
  const session = await stripe<{ id: string; url: string }>("POST", "/checkout/sessions", {
    mode: "subscription",
    customer,
    line_items: items,
    allow_promotion_codes: "true",
    client_reference_id: v.orgId,
    success_url: `${v.appUrl}/app/settings/billing?checkout=done`,
    cancel_url: `${v.appUrl}/app/settings/billing?checkout=cancelled`,
    subscription_data: { metadata: { orgId: v.orgId, planKey: v.planKey } },
    metadata: { orgId: v.orgId, planKey: v.planKey, interval: v.interval },
    ...(process.env.STRIPE_TAX === "1" ? { automatic_tax: { enabled: "true" }, customer_update: { address: "auto", name: "auto" } } : {}),
  });
  return session.url;
}

export async function billingPortal(orgId: string, appUrl: string) {
  const s = await getSubscription(orgId);
  if (!s.stripeCustomerId) throw new UserFacingError("There's no billing account yet — choose a plan first.");
  const r = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: s.stripeCustomerId, return_url: `${appUrl}/app/settings/billing` });
  return r.url;
}

// ─── Webhooks ──────────────────────────────────────────────────────────────────

type StripeSub = { id: string; customer: string; status: string; current_period_end?: number; cancel_at_period_end?: boolean; metadata?: Record<string, string>; items?: { data: { quantity?: number }[] } };
const STATUS: Record<string, string> = { active: "ACTIVE", trialing: "ACTIVE", past_due: "PAST_DUE", unpaid: "READ_ONLY", canceled: "CANCELED", incomplete: "PAST_DUE", incomplete_expired: "CANCELED", paused: "READ_ONLY" };

async function orgForCustomer(customer: string, metaOrg?: string) {
  if (metaOrg) return metaOrg;
  return (await adminDb.subscription.findFirst({ where: { stripeCustomerId: customer }, select: { orgId: true } }))?.orgId ?? null;
}

/** Apply one Stripe event. Returns false when it was already handled (Stripe re-delivers). */
export async function handleStripeEvent(e: { id: string; type: string; data: { object: Record<string, unknown> } }, now = new Date()) {
  try {
    await adminDb.stripeEvent.create({ data: { id: e.id, type: e.type } });
  } catch {
    return false; // already processed
  }
  const o = e.data.object;
  if (e.type === "checkout.session.completed") {
    const orgId = (o.client_reference_id as string) || (o.metadata as Record<string, string> | undefined)?.orgId;
    if (orgId && o.subscription) {
      const meta = (o.metadata ?? {}) as Record<string, string>;
      await getSubscription(orgId);
      await adminDb.subscription.update({ where: { orgId }, data: { stripeCustomerId: o.customer as string, stripeSubscriptionId: o.subscription as string, status: "ACTIVE", planKey: meta.planKey ?? undefined, interval: meta.interval ?? undefined, pastDueSince: null, compReason: null, compUntil: null } });
    }
  } else if (e.type.startsWith("customer.subscription.")) {
    const sub = o as unknown as StripeSub;
    const orgId = await orgForCustomer(sub.customer, sub.metadata?.orgId);
    if (orgId) {
      const s = await getSubscription(orgId);
      const status = e.type === "customer.subscription.deleted" ? "CANCELED" : STATUS[sub.status] ?? "PAST_DUE";
      await adminDb.subscription.update({ where: { orgId }, data: {
        stripeCustomerId: sub.customer, stripeSubscriptionId: sub.id, status,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        pastDueSince: status === "PAST_DUE" ? (s.pastDueSince ?? now) : null,
        billedUnits: sub.items?.data[0]?.quantity ?? s.billedUnits,
        ...(sub.metadata?.planKey ? { planKey: sub.metadata.planKey } : {}),
      } });
    }
  } else if (e.type === "invoice.payment_failed" || e.type === "invoice.paid") {
    const orgId = await orgForCustomer(o.customer as string);
    if (orgId) {
      const s = await getSubscription(orgId);
      await adminDb.subscription.update({ where: { orgId }, data: e.type === "invoice.paid" ? { status: s.status === "COMPLIMENTARY" ? s.status : "ACTIVE", pastDueSince: null } : { status: "PAST_DUE", pastDueSince: s.pastDueSince ?? now } });
    }
  }
  return true;
}

/** Suggested hosted plan for a company's unit count. */
export const suggestPlan = hostedPlanFor;
