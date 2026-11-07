/** InsuranceProvider adapter: partner quotes for renters insurance. The mock returns a fixed offer. */
export type InsuranceQuote = { partner: string; monthly: string; blurb: string; url: string };

export interface InsuranceProvider {
  readonly name: string;
  quote(): Promise<InsuranceQuote>;
}

class MockInsuranceProvider implements InsuranceProvider {
  readonly name = "mock";
  async quote(): Promise<InsuranceQuote> {
    return { partner: "Partner coverage", monthly: "$12", blurb: "$100,000 liability and $15,000 personal property. Proof is sent to your manager automatically.", url: "#insurance-partner" };
  }
}

let p: InsuranceProvider | undefined;
export function getInsuranceProvider(): InsuranceProvider {
  p ??= new MockInsuranceProvider();
  return p;
}
