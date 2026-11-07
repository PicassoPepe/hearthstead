import { describe, expect, it } from "vitest";
import { cardBrand, convenienceFee, luhn, TRANSITIONS } from "@/lib/payments";
import { MockPaymentsProvider } from "@/adapters/payments/mock";

describe("convenience fees (pass-through)", () => {
  it("card: 2.9% + 30¢, rounded half-up", () => {
    expect(convenienceFee("CARD", 150_000, true)).toBe(4380);
    expect(convenienceFee("CARD", 1, true)).toBe(30);
  });
  it("ACH: 0.8% capped at $5", () => {
    expect(convenienceFee("ACH", 10_000, true)).toBe(80);
    expect(convenienceFee("ACH", 150_000, true)).toBe(500);
  });
  it("zero when not passed through", () => expect(convenienceFee("CARD", 150_000, false)).toBe(0));
});

describe("card helpers", () => {
  it("luhn", () => {
    expect(luhn("4242 4242 4242 4242")).toBe(true);
    expect(luhn("4242 4242 4242 4241")).toBe(false);
  });
  it("brand", () => {
    expect(cardBrand("4242424242424242")).toBe("Visa");
    expect(cardBrand("5555555555554444")).toBe("Mastercard");
    expect(cardBrand("378282246310005")).toBe("Amex");
  });
});

describe("payment status machine", () => {
  it("terminal states don't move; ACH can fail after success (late return)", () => {
    expect(TRANSITIONS.PAID_OUT).toEqual([]);
    expect(TRANSITIONS.FAILED).toEqual([]);
    expect(TRANSITIONS.PROCESSING).toEqual(["SUCCEEDED", "FAILED"]);
    expect(TRANSITIONS.SUCCEEDED).toContain("FAILED");
  });
});

describe("mock processor behaves like Stripe test mode", () => {
  const m = new MockPaymentsProvider();
  it("cards", async () => {
    const ok = await m.addCard({ number: "4242424242424242", expMonth: 12, expYear: 2031, cvc: "123" });
    expect(ok).toMatchObject({ type: "CARD", brand: "Visa", last4: "4242", verified: true });
    expect((await m.charge({ connectedAccount: "a", methodType: "CARD", methodRef: ok.providerRef, totalCents: 100, feeCents: 0, idempotencyKey: "k", description: "" })).status).toBe("SUCCEEDED");
    const bad = await m.addCard({ number: "4000000000000002", expMonth: 12, expYear: 2031, cvc: "123" });
    expect((await m.charge({ connectedAccount: "a", methodType: "CARD", methodRef: bad.providerRef, totalCents: 100, feeCents: 0, idempotencyKey: "k", description: "" })).status).toBe("FAILED");
    await expect(m.addCard({ number: "4242424242424241", expMonth: 12, expYear: 2031, cvc: "123" })).rejects.toThrow(/isn't valid/);
    await expect(m.addCard({ number: "4242424242424242", expMonth: 1, expYear: 2020, cvc: "123" })).rejects.toThrow(/expired/);
  });
  it("ACH settles later; accounts ending 0002 fail at settlement", async () => {
    const ok = await m.verifyBank({ routingNumber: "110000000", accountNumber: "000123456789", holderName: "T" });
    const nsf = await m.verifyBank({ routingNumber: "110000000", accountNumber: "000000000002", holderName: "T" });
    const c1 = await m.charge({ connectedAccount: "a", methodType: "ACH", methodRef: ok.providerRef, totalCents: 100, feeCents: 0, idempotencyKey: "k", description: "" });
    const c2 = await m.charge({ connectedAccount: "a", methodType: "ACH", methodRef: nsf.providerRef, totalCents: 100, feeCents: 0, idempotencyKey: "k", description: "" });
    expect([c1.status, c2.status]).toEqual(["PROCESSING", "PROCESSING"]);
    expect(await m.settle(c1.providerRef)).toBe("SUCCEEDED");
    expect(await m.settle(c2.providerRef)).toBe("FAILED");
    await expect(m.verifyBank({ routingNumber: "12345", accountNumber: "1", holderName: "T" })).rejects.toThrow(/9 digits/);
  });
});
