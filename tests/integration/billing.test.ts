import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { formEncode, setStripeFetcher, verifyStripeSignature } from "@/server/billing/stripe-client";
import { billingReadOnly, billingState, endComp, getSubscription, handleStripeEvent, hostedBillingNotice, startCheckout, stripeLine, TRIAL_DAYS } from "@/server/billing/subscription";
import { compOrg, endCompOrg, type PlatformCtx } from "@/server/platform-admin/service";
import { POST as webhook } from "@/app/api/webhooks/stripe/route";
import { DEFAULT_PLANS, quote } from "@/lib/pricing";
import { admin, app, cleanup, makeOrg } from "./helpers";

const orgs: string[] = [];
const users: string[] = [];
let orgId: string;
let p: PlatformCtx;
const DAY = 86_400_000;

beforeAll(async () => {
  const o = await makeOrg("billing");
  orgId = o.orgId; orgs.push(o.orgId); users.push(o.userId);
  const u = await admin.user.create({ data: { email: `billadmin-${Date.now()}@deedwood.test`, twoFactorEnabled: true } });
  users.push(u.id);
  p = { userId: u.id, email: u.email, name: null, role: "OWNER", ip: "203.0.113.9", userAgent: "vitest" };
});
afterEach(() => { delete process.env.BILLING_ENFORCED; delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });
afterAll(async () => {
  await admin.platformAuditLog.deleteMany({ where: { actorUserId: p.userId } });
  await admin.stripeEvent.deleteMany({ where: { id: { startsWith: "evt_test_" } } });
  await cleanup(orgs, users);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

const base = { status: "TRIALING", trialEndsAt: null, compUntil: null, pastDueSince: null, currentPeriodEnd: null };

describe("billing state", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  it("trial counts down then ends", () => {
    expect(billingState({ ...base, trialEndsAt: new Date(now.getTime() + 3.5 * DAY) }, now)).toEqual({ state: "trial", daysLeft: 4 });
    expect(billingState({ ...base, trialEndsAt: new Date(now.getTime() - 1) }, now).state).toBe("trial_ended");
  });
  it("comped is free, and an end date turns it back into a choice", () => {
    expect(billingState({ ...base, status: "BETA" }, now)).toEqual({ state: "comped" });
    expect(billingState({ ...base, status: "COMPLIMENTARY", compUntil: new Date(now.getTime() + 10 * DAY) }, now)).toEqual({ state: "comped", daysLeft: 10 });
    expect(billingState({ ...base, status: "BETA", compUntil: new Date(now.getTime() - DAY) }, now).state).toBe("trial_ended");
  });
  it("past due gets a grace period before read-only; canceled keeps access until the paid period ends", () => {
    expect(billingState({ ...base, status: "PAST_DUE", pastDueSince: new Date(now.getTime() - DAY) }, now)).toEqual({ state: "past_due", daysLeft: 2 });
    expect(billingState({ ...base, status: "PAST_DUE", pastDueSince: new Date(now.getTime() - 4 * DAY) }, now).state).toBe("read_only");
    expect(billingState({ ...base, status: "CANCELED", currentPeriodEnd: new Date(now.getTime() + DAY) }, now).state).toBe("active");
    expect(billingState({ ...base, status: "CANCELED", currentPeriodEnd: new Date(now.getTime() - DAY) }, now).state).toBe("canceled");
  });
});

describe("stripe prices", () => {
  it("uses the sandbox lookup keys and charges at least the plan minimum", () => {
    expect(stripeLine("hosted_starter", "month", 10)).toEqual({ lookupKey: "starter_monthly", quantity: 1 });
    expect(stripeLine("hosted_starter", "year", 10)).toEqual({ lookupKey: "starter_yearly", quantity: 1 });
    expect(stripeLine("hosted_growth", "month", 30)).toEqual({ lookupKey: "growth_unit_monthly", quantity: 40 }); // $99 min ÷ $2.50
    expect(stripeLine("hosted_growth", "month", 80)).toEqual({ lookupKey: "growth_unit_monthly", quantity: 80 });
    // Scale monthly uses the graduated price ($1.75/unit for 1–250, $1.50 above); Stripe applies the tiers.
    expect(stripeLine("hosted_scale", "month", 120)).toEqual({ lookupKey: "scale_unit_monthly_tiered", quantity: 120 });
    expect(stripeLine("hosted_scale", "month", 300)).toEqual({ lookupKey: "scale_unit_monthly_tiered", quantity: 300 });
    expect(quote(DEFAULT_PLANS.find((x) => x.key === "hosted_scale")!, 300, "month")).toBe(250 * 175 + 50 * 150); // what Stripe's tiers charge for 300
    expect(stripeLine("hosted_scale", "month", 50).quantity).toBe(100); // $175 min ÷ $1.75
    // Yearly uses the graduated price; Stripe applies the tiers, quantity = units.
    expect(stripeLine("hosted_scale", "year", 101)).toEqual({ lookupKey: "scale_unit_yearly_tiered", quantity: 101 });
    expect(stripeLine("hosted_scale", "year", 400)).toEqual({ lookupKey: "scale_unit_yearly_tiered", quantity: 400 });
    // Below the $1,750 minimum: raised to the first count that reaches it (100 × $17.40 = $1,740 < $1,750).
    expect(stripeLine("hosted_scale", "year", 40).quantity).toBe(101);
    expect(stripeLine("hosted_scale", "year", 100).quantity).toBe(101);
    expect(stripeLine("local_annual", "year", 5)).toEqual({ lookupKey: "local_unit_yearly", quantity: 14 }); // $199 min ÷ $15
    expect(() => stripeLine("hosted_growth", "year", 50)).toThrow(/monthly/);
    expect(() => stripeLine("nope", "month", 5)).toThrow();
  });
  it("encodes nested form fields the way Stripe expects", () => {
    expect(formEncode({ line_items: [{ price: "p", quantity: 2 }], metadata: { orgId: "o" }, skip: null })).toEqual([["line_items[0][price]", "p"], ["line_items[0][quantity]", "2"], ["metadata[orgId]", "o"]]);
  });
});

describe("checkout (mocked Stripe)", () => {
  it("creates the customer once and a subscription checkout with promo codes allowed", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const calls: { url: string; body: string; idem?: string }[] = [];
    setStripeFetcher(async (url, init) => {
      const h = init.headers as Record<string, string>;
      calls.push({ url, body: String(init.body ?? ""), idem: h["Idempotency-Key"] });
      if (url.includes("/prices")) return Response.json({ data: [{ id: "price_growth" }] });
      if (url.endsWith("/customers")) return Response.json({ id: "cus_test_1" });
      if (url.endsWith("/checkout/sessions")) return Response.json({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
      return Response.json({ error: { message: "unexpected" } }, { status: 400 });
    });
    const url = await startCheckout({ orgId, email: "owner@example.com", planKey: "hosted_growth", interval: "month", units: 30, appUrl: "https://app.test" });
    expect(url).toBe("https://checkout.stripe.test/cs_1");
    expect(calls[0]!.url).toContain("lookup_keys%5B0%5D=growth_unit_monthly");
    expect(calls.find((c) => c.url.endsWith("/customers"))!.idem).toBe(`cust-${orgId}`);
    const body = new URLSearchParams(calls.find((c) => c.url.endsWith("/checkout/sessions"))!.body);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("customer")).toBe("cus_test_1");
    expect(body.get("line_items[0][quantity]")).toBe("40");
    expect(body.get("allow_promotion_codes")).toBe("true");
    expect(body.get("client_reference_id")).toBe(orgId);
    expect(body.get("success_url")).toBe("https://app.test/app/settings/billing?checkout=done");
    expect((await getSubscription(orgId)).stripeCustomerId).toBe("cus_test_1");
    // Second time: the saved customer is reused.
    calls.length = 0;
    await startCheckout({ orgId, email: "owner@example.com", planKey: "hosted_growth", interval: "month", units: 30, appUrl: "https://app.test" });
    expect(calls.some((c) => c.url.endsWith("/customers"))).toBe(false);
  });
  it("turns Stripe errors into plain messages", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    setStripeFetcher(async () => Response.json({ data: [] }));
    await expect(startCheckout({ orgId, email: "o@example.com", planKey: "hosted_starter", interval: "month", units: 3, appUrl: "https://app.test" })).rejects.toThrow(/isn't set up in Stripe/);
    setStripeFetcher(async () => { throw new Error("network"); });
    await expect(startCheckout({ orgId, email: "o@example.com", planKey: "hosted_starter", interval: "month", units: 3, appUrl: "https://app.test" })).rejects.toThrow(/didn't answer/);
  });
});

describe("webhooks", () => {
  const sign = (payload: string, secret: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

  it("verifies Stripe's signature and rejects tampering or old timestamps", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(body, sign(body, "whsec_a"), "whsec_a")).toBe(true);
    expect(verifyStripeSignature(body + " ", sign(body, "whsec_a"), "whsec_a")).toBe(false);
    expect(verifyStripeSignature(body, sign(body, "whsec_b"), "whsec_a")).toBe(false);
    expect(verifyStripeSignature(body, sign(body, "whsec_a", Math.floor(Date.now() / 1000) - 3600), "whsec_a")).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec_a")).toBe(false);
  });

  it("the endpoint refuses unsigned calls and handles each event once", async () => {
    const ev = { id: `evt_test_${Date.now()}`, type: "checkout.session.completed", data: { object: { client_reference_id: orgId, customer: "cus_test_1", subscription: "sub_test_1", metadata: { orgId, planKey: "hosted_growth", interval: "month" } } } };
    const body = JSON.stringify(ev);
    const req = (sig: string | null) => new Request("https://app.test/api/webhooks/stripe", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} });
    expect((await webhook(req(null))).status).toBe(503); // no secret configured yet
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    expect((await webhook(req("t=1,v1=bad"))).status).toBe(400);
    const ok = await webhook(req(sign(body, "whsec_test")));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, duplicate: false });
    const again = await webhook(req(sign(body, "whsec_test")));
    expect(await again.json()).toMatchObject({ duplicate: true });
    const s = await getSubscription(orgId);
    expect(s).toMatchObject({ status: "ACTIVE", planKey: "hosted_growth", stripeSubscriptionId: "sub_test_1" });
  });

  it("payment failure → past due (grace) → read-only only when enforced; paying fixes it; data stays", async () => {
    const id = () => `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const t0 = new Date();
    await handleStripeEvent({ id: id(), type: "invoice.payment_failed", data: { object: { customer: "cus_test_1" } } }, t0);
    expect((await getSubscription(orgId)).status).toBe("PAST_DUE");
    const later = new Date(t0.getTime() + 5 * DAY);
    expect(await billingReadOnly(orgId, later)).toBe(false); // not enforced
    process.env.BILLING_ENFORCED = "1";
    expect(await billingReadOnly(orgId, t0)).toBe(false); // still in grace
    expect((await hostedBillingNotice(orgId, t0))?.readOnly).toBe(false);
    expect(await billingReadOnly(orgId, later)).toBe(true);
    expect((await hostedBillingNotice(orgId, later))?.readOnly).toBe(true);
    expect(await admin.organization.count({ where: { id: orgId } })).toBe(1);
    await handleStripeEvent({ id: id(), type: "invoice.paid", data: { object: { customer: "cus_test_1" } } }, later);
    expect(await billingReadOnly(orgId, later)).toBe(false);
    await handleStripeEvent({ id: id(), type: "customer.subscription.updated", data: { object: { id: "sub_test_1", customer: "cus_test_1", status: "active", cancel_at_period_end: true, current_period_end: Math.floor((t0.getTime() + 20 * DAY) / 1000), items: { data: [{ quantity: 42 }] } } } });
    expect(await getSubscription(orgId)).toMatchObject({ cancelAtPeriodEnd: true, billedUnits: 42 });
    await handleStripeEvent({ id: id(), type: "customer.subscription.deleted", data: { object: { id: "sub_test_1", customer: "cus_test_1", status: "canceled", current_period_end: Math.floor((t0.getTime() - DAY) / 1000) } } });
    expect(await billingReadOnly(orgId)).toBe(true);
  });
});

describe("free beta (comp)", () => {
  it("needs a reason, can't end in the past, is audited, and ending it starts a fresh trial", async () => {
    const o = await makeOrg("comp");
    orgs.push(o.orgId); users.push(o.userId);
    await expect(compOrg(p, o.orgId, { reason: "", until: null })).rejects.toThrow(/reason/);
    await expect(compOrg(p, o.orgId, { reason: "First beta user", until: "2020-01-01" })).rejects.toThrow(/future/);
    await compOrg(p, o.orgId, { reason: "First beta user", until: null });
    let s = await getSubscription(o.orgId);
    expect(s).toMatchObject({ status: "BETA", compReason: "First beta user", compUntil: null });
    process.env.BILLING_ENFORCED = "1";
    expect(await billingReadOnly(o.orgId)).toBe(false);
    expect(await hostedBillingNotice(o.orgId)).toBeNull();
    const log = await admin.platformAuditLog.findFirst({ where: { actorUserId: p.userId, action: "billing.comped", targetId: o.orgId } });
    expect(log?.reason).toBe("First beta user");
    await endCompOrg(p, o.orgId, "Beta is over");
    s = await getSubscription(o.orgId);
    expect(s.status).toBe("TRIALING");
    expect(s.trialEndsAt!.getTime()).toBeGreaterThan(Date.now() + (TRIAL_DAYS - 1) * DAY);
    expect(await admin.platformAuditLog.count({ where: { action: "billing.comp_ended", targetId: o.orgId } })).toBe(1);
    await expect(endCompOrg(p, o.orgId, "Again please")).rejects.toThrow(/isn't on a free plan/);
  });
  it("a free beta is never flipped to billed or past-due by a Stripe webhook", async () => {
    const o = await makeOrg("beta-webhook");
    orgs.push(o.orgId); users.push(o.userId);
    await compOrg(p, o.orgId, { reason: "Wendy beta", until: null });
    await admin.subscription.update({ where: { orgId: o.orgId }, data: { stripeCustomerId: "cus_beta_wendy" } });
    const id = () => `evt_beta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await handleStripeEvent({ id: id(), type: "invoice.paid", data: { object: { customer: "cus_beta_wendy" } } });
    await handleStripeEvent({ id: id(), type: "invoice.payment_failed", data: { object: { customer: "cus_beta_wendy" } } });
    await handleStripeEvent({ id: id(), type: "checkout.session.completed", data: { object: { customer: "cus_beta_wendy", subscription: "sub_beta", client_reference_id: o.orgId, metadata: { planKey: "hosted_starter", interval: "month" } } } });
    await handleStripeEvent({ id: id(), type: "customer.subscription.updated", data: { object: { id: "sub_beta", customer: "cus_beta_wendy", status: "active", metadata: { orgId: o.orgId } } } });
    expect(await getSubscription(o.orgId)).toMatchObject({ status: "BETA", compReason: "Wendy beta" });
    process.env.BILLING_ENFORCED = "1";
    expect(await billingReadOnly(o.orgId)).toBe(false);
    await expect(startCheckout({ orgId: o.orgId, email: "wendy@example.com", planKey: "hosted_starter", interval: "month", units: 1, appUrl: "https://deedwood.com" })).rejects.toThrow(/free plan/);
  });

  it("a paid company that was comped goes back to its paid plan", async () => {
    await admin.subscription.update({ where: { orgId }, data: { stripeSubscriptionId: "sub_test_2", status: "BETA" } });
    expect((await endComp(orgId)).status).toBe("ACTIVE");
  });
});
