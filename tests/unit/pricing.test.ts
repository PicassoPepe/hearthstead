import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS, hostedPlanFor, quote } from "@/lib/pricing";

const plan = (k: string) => DEFAULT_PLANS.find((p) => p.key === k)!;

describe("accepted price list", () => {
  it("Starter is $49/month or $470/year flat", () => {
    expect(quote(plan("hosted_starter"), 10, "month")).toBe(4_900);
    expect(quote(plan("hosted_starter"), 25, "year")).toBe(47_000);
  });
  it("Growth is $2.50/unit with a $99 minimum ($2.08 / $990 yearly)", () => {
    expect(quote(plan("hosted_growth"), 30, "month")).toBe(9_900);
    expect(quote(plan("hosted_growth"), 80, "month")).toBe(20_000);
    expect(quote(plan("hosted_growth"), 30, "year")).toBe(99_000);
    expect(quote(plan("hosted_growth"), 100, "year")).toBe(99_000);
  });
  it("Scale is $1.75/unit ($175 min) and $1.50 above 250 units", () => {
    expect(quote(plan("hosted_scale"), 101, "month")).toBe(17_675);
    expect(quote(plan("hosted_scale"), 250, "month")).toBe(43_750);
    expect(quote(plan("hosted_scale"), 300, "month")).toBe(250 * 175 + 50 * 150);
    expect(quote(plan("hosted_scale"), 300, "year")).toBe(175_000); // $1,750 yearly minimum still applies
    expect(quote(plan("hosted_scale"), 1_500, "year")).toBe(250 * 145 + 1_250 * 125);
    expect(quote(plan("hosted_scale"), 50, "year")).toBe(175_000);
  });
  it("Local is $15/unit/year with a $199 minimum; Care adds $249", () => {
    expect(quote(plan("local_annual"), 5, "year")).toBe(19_900);
    expect(quote(plan("local_annual"), 40, "year")).toBe(60_000);
    expect(quote(plan("local_care"), 40, "year")).toBe(60_000 + 24_900);
    expect(Number.isNaN(quote(plan("local_annual"), 40, "month"))).toBe(true);
  });
  it("suggests the hosted plan by unit count", () => {
    expect(hostedPlanFor(25)).toBe("hosted_starter");
    expect(hostedPlanFor(26)).toBe("hosted_growth");
    expect(hostedPlanFor(101)).toBe("hosted_scale");
  });
});
