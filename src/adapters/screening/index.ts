/**
 * ScreeningProvider adapter: credit, criminal and eviction checks for an applicant.
 * `mock` (default) is deterministic so demos and tests are repeatable:
 *   - SSN last 4 "0000" → no credit file (thin file); "6666" → eviction record; "1313" → criminal record
 *   - otherwise the credit score is derived from the name (580–800).
 * Real providers (TransUnion SmartMove, RentPrep…) plug in behind the same interface.
 */
export type ScreeningInput = { firstName: string; lastName: string; email: string; dob?: string | null; ssnLast4?: string | null; monthlyIncomeCents: number; rentCents: number };
export type ScreeningResult = {
  provider: string;
  reportId: string;
  creditScore: number | null;
  criminal: "CLEAR" | "RECORDS_FOUND";
  eviction: "CLEAR" | "RECORDS_FOUND";
  incomeToRent: number | null;
  recommendation: "ACCEPT" | "CONDITIONAL" | "DECLINE";
  reasons: string[];
};

export interface ScreeningProvider {
  readonly name: string;
  screen(input: ScreeningInput): Promise<ScreeningResult>;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

class MockScreeningProvider implements ScreeningProvider {
  readonly name = "mock";
  async screen(i: ScreeningInput): Promise<ScreeningResult> {
    const key = `${i.firstName}|${i.lastName}|${i.email}`.toLowerCase();
    const creditScore = i.ssnLast4 === "0000" ? null : 580 + (hash(key) % 221);
    const criminal = i.ssnLast4 === "1313" ? "RECORDS_FOUND" : "CLEAR";
    const eviction = i.ssnLast4 === "6666" ? "RECORDS_FOUND" : "CLEAR";
    const incomeToRent = i.rentCents > 0 ? Math.round((i.monthlyIncomeCents / i.rentCents) * 100) / 100 : null;
    const reasons: string[] = [];
    if (creditScore === null) reasons.push("No credit history found");
    else if (creditScore < 620) reasons.push(`Credit score ${creditScore} is below 620`);
    if (incomeToRent !== null && incomeToRent < 3) reasons.push(`Income is ${incomeToRent}× rent (3× required)`);
    if (eviction === "RECORDS_FOUND") reasons.push("Prior eviction record");
    if (criminal === "RECORDS_FOUND") reasons.push("Criminal record found — review individually");
    const recommendation = eviction === "RECORDS_FOUND" || (creditScore !== null && creditScore < 580) ? "DECLINE" : reasons.length ? "CONDITIONAL" : "ACCEPT";
    return { provider: this.name, reportId: `SCR-${hash(key + Date.now()).toString(36).toUpperCase()}`, creditScore, criminal, eviction, incomeToRent, recommendation, reasons };
  }
}

let p: ScreeningProvider | undefined;
export function getScreeningProvider(): ScreeningProvider {
  p ??= new MockScreeningProvider();
  return p;
}
