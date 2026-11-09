import { afterEach, describe, expect, it } from "vitest";
import { setPaymentsFetcher, StripePaymentsProvider } from "@/adapters/payments/stripe";

type Call = { method: string; url: string; body: URLSearchParams; idem?: string };
function fake(route: (c: Call) => unknown) {
  const calls: Call[] = [];
  setPaymentsFetcher(async (url, init) => {
    const c = { method: String(init.method), url, body: new URLSearchParams(String(init.body ?? "")), idem: (init.headers as Record<string, string>)["Idempotency-Key"] };
    calls.push(c);
    return Response.json(route(c));
  });
  return calls;
}
afterEach(() => setPaymentsFetcher((url, init) => fetch(url, init)));
const stripe = new StripePaymentsProvider("sk_test_x", "https://app.test");

describe("Stripe: saving cards and banks with the secure form", () => {
  it("creates the tenant's customer once, then a SetupIntent for card + instantly-verified bank", async () => {
    const calls = fake((c) => (c.url.endsWith("/customers") ? { id: "cus_1" } : { client_secret: "seti_1_secret_2" }));
    const r = await stripe.startSetup({ customerRef: null, name: "Dee Tenant", email: "dee@example.com", idempotencyKey: "ten_1" });
    expect(r).toEqual({ customerRef: "cus_1", clientSecret: "seti_1_secret_2" });
    expect(calls[0]!.idem).toBe("cust-ten_1");
    const si = calls[1]!.body;
    expect(si.get("customer")).toBe("cus_1");
    expect(si.get("usage")).toBe("off_session");
    expect([si.get("payment_method_types[0]"), si.get("payment_method_types[1]")]).toEqual(["card", "us_bank_account"]);
    expect(si.get("payment_method_options[us_bank_account][verification_method]")).toBe("instant");
    // Next time the saved customer is reused.
    calls.length = 0;
    await stripe.startSetup({ customerRef: "cus_1", name: "Dee", email: null, idempotencyKey: "ten_1" });
    expect(calls.map((c) => c.url.split("/v1")[1])).toEqual(["/setup_intents"]);
  });

  it("reads back only brand/bank and last 4, and refuses unfinished setups", async () => {
    fake(() => ({ status: "succeeded", customer: "cus_1", payment_method: { id: "pm_card", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } } }));
    expect(await stripe.methodFromSetup("seti_123")).toEqual({ customerRef: "cus_1", providerRef: "pm_card", type: "CARD", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, verified: true });
    const calls = fake(() => ({ status: "succeeded", customer: "cus_1", payment_method: { id: "pm_bank", type: "us_bank_account", us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789" } } }));
    expect(await stripe.methodFromSetup("seti_456")).toMatchObject({ type: "ACH", bankName: "STRIPE TEST BANK", last4: "6789" });
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.stripe.com/v1/setup_intents/seti_456?expand[]=payment_method" });
    fake(() => ({ status: "requires_payment_method", customer: "cus_1", payment_method: null }));
    await expect(stripe.methodFromSetup("seti_789")).rejects.toThrow(/wasn't confirmed/);
    await expect(stripe.methodFromSetup("../customers")).rejects.toThrow(/couldn't be saved/);
  });

  it("typed card numbers are refused; saved methods are charged on the tenant's customer", async () => {
    await expect(stripe.addCard({ number: "4242424242424242", expMonth: 1, expYear: 2030, cvc: "123" })).rejects.toThrow(/Stripe Elements/);
    const calls = fake(() => ({ id: "pi_1", status: "processing" }));
    await stripe.charge({ connectedAccount: "acct_9", methodType: "ACH", methodRef: "pm_bank", totalCents: 155_000, feeCents: 0, idempotencyKey: "k1", description: "Rent", customerRef: "cus_1" });
    const b = calls[0]!.body;
    expect(b.get("customer")).toBe("cus_1");
    expect(b.get("off_session")).toBe("true");
    expect(b.get("payment_method_types[]")).toBe("us_bank_account");
    expect(b.get("transfer_data[destination]")).toBe("acct_9");
  });
});
