import { createNodePrisma } from "./node-client.mjs";
import { createScopedClient } from "../src/server/dal";
import { createLeaseInTx, endLease, runRecurringForLease, setEviction } from "../src/server/leasing/leases";
import { assessLateFees, lateFeePolicy } from "../src/server/leasing/late-fees";
import * as M from "../src/server/leasing/money";
import { leaseWizardSchema } from "../src/lib/leasing";
import { addDays, addMonths, startOfMonth, toISODate, utcDate } from "../src/lib/dates";

/**
 * 50 leases with up to 18 months of history, simulated month by month through the real
 * ledger services (so every posting is balanced and every invariant holds):
 *   - most tenants pay on time; some pay late (late fees), some pay partially (balances),
 *   - one bounced check (returned payment + NSF fee), one eviction,
 *   - three turnovers (move-out with prorated credit + deposit refund, then a new tenant).
 */
function rng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Taylor", "Jamie", "Quinn", "Rowan", "Sasha", "Elena", "Marcus", "Priya", "Diego", "Hana", "Omar", "Leah", "Noah", "Zoe", "Mateo", "Aisha", "Ben", "Chloe", "Dev", "Ines", "Kofi", "Lina", "Max", "Nadia", "Owen", "Rosa", "Sam", "Tara", "Victor", "Wen", "Yusuf"];
const LAST = ["Alvarez", "Brooks", "Chen", "Diaz", "Ellis", "Fischer", "Garcia", "Hughes", "Ibrahim", "Jensen", "Kim", "Lopez", "Morales", "Nguyen", "Okoye", "Patel", "Quinn", "Rossi", "Silva", "Tanaka", "Underwood", "Vargas", "Wright", "Xu", "Young", "Zimmerman"];
const COMPANIES: Record<string, string> = {
  COMMERCIAL_RETAIL: "Corner Bakery Co.|Northside Cycles|Lumen Optical|Fern & Fig Florals",
  COMMERCIAL_OFFICE: "Brightline Dental|Keel Accounting LLP|Atlas Insurance Group|Pinecrest Therapy|Harbor Legal PC|Quill Design Studio",
  COMMERCIAL_INDUSTRIAL: "Midway Logistics|Ferro Fabrication|Greenleaf Supply|Union Print Works",
};

type Profile = "ONTIME" | "LATE" | "PARTIAL" | "NSF" | "EVICTION";

export async function seedLeasing(appUrl: string, orgId: string, userId: string, today: Date) {
  const app = createNodePrisma(appUrl);
  const db = createScopedClient(app, { orgId, userId });
  const r = rng(7);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const a = { orgId, userId };
  const historyStart = startOfMonth(addMonths(today, -17)); // 18 months including this one
  const rentAcct = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const otherAcct = (await db.account.findFirstOrThrow({ where: { systemKey: "OTHER_INCOME" } })).id;

  const units = await db.unit.findMany({ include: { property: true }, orderBy: [{ property: { name: "asc" } }, { name: "asc" }] });
  // Leave 13 units vacant (mostly office suites and industrial bays) → 47 occupied.
  const vacantIds = new Set(
    [...units.filter((u) => u.property.type === "COMMERCIAL_OFFICE").slice(0, 4), ...units.filter((u) => u.property.type === "COMMERCIAL_INDUSTRIAL").slice(0, 3), ...units.filter((u) => u.property.type === "MULTI_FAMILY").filter((_, i) => i % 7 === 3).slice(0, 4), ...units.filter((u) => u.property.type === "CONDO").slice(0, 2)].map((u) => u.id),
  );
  const leased = units.filter((u) => !vacantIds.has(u.id));
  const turnoverIds = new Set([leased[1]!.id, leased[9]!.id, leased[20]!.id]);
  const companyPools = Object.fromEntries(Object.entries(COMPANIES).map(([k, v]) => [k, v.split("|")]));

  let leases = 0;
  let nameIdx = 0;
  const profiles: Profile[] = [];
  const counts = { lateFees: 0, returned: 0 };

  async function simulate(unit: (typeof units)[number], start: Date, end: Date | null, profile: Profile, moveOut: Date | null) {
    const commercial = unit.property.type.startsWith("COMMERCIAL");
    const company = commercial ? (companyPools[unit.property.type]?.shift() ?? null) : null;
    const first = FIRST[nameIdx % FIRST.length]!;
    const last = LAST[(nameIdx * 7) % LAST.length]!;
    nameIdx++;
    const rent = Math.round((unit.marketRentCents * (0.94 + r() * 0.06)) / 2500) * 2500;
    const tenants: unknown[] = [
      company
        ? { newTenant: { kind: "COMPANY", companyName: company, email: `ap@${company.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`, phone: "(312) 555-0" + String(100 + nameIdx).slice(-3) }, role: "PRIMARY" }
        : { newTenant: { kind: "PERSON", firstName: first, lastName: last, email: `${first}.${last}${nameIdx}@example.com`.toLowerCase(), phone: `(312) 555-${String(1000 + nameIdx * 37).slice(-4)}` }, role: "PRIMARY" },
    ];
    if (!commercial && r() < 0.3) tenants.push({ newTenant: { kind: "PERSON", firstName: pick(FIRST), lastName: last }, role: "COTENANT" });
    const recurring: unknown[] = [{ kind: "RENT", accountId: rentAcct, description: "Rent", amountCents: rent }];
    if (!commercial && r() < 0.25) recurring.push({ kind: "OTHER", accountId: otherAcct, description: "Parking", amountCents: 7500 });
    const v = leaseWizardSchema.parse({
      status: "ACTIVE", propertyId: unit.propertyId, unitIds: [unit.id], termType: end ? "FIXED" : "MONTH_TO_MONTH",
      startDate: toISODate(start), endDate: end ? toISODate(end) : "", tenants, recurring,
      deposit: { amountCents: rent, handling: "RECEIVED" }, portalInvite: r() < 0.6,
    });

    const leaseId = await db.tx((tx) => createLeaseInTx(tx, a, v, start), { timeout: 120_000 });
    const { policy, order } = await lateFeePolicy(db, unit.propertyId, leaseId);
    const stopAt = moveOut ?? today;
    await db.tx(
      async (tx) => {
        let month = startOfMonth(start);
        let nsfDone = false;
        while (month <= stopAt) {
          const due = utcDate(month.getUTCFullYear(), month.getUTCMonth(), 1);
          await runRecurringForLease(tx, a, leaseId, due < start ? start : due, order);
          const monthsLeft = (today.getUTCFullYear() - month.getUTCFullYear()) * 12 + today.getUTCMonth() - month.getUTCMonth();
          let payDay: Date | null = addDays(due, Math.floor(r() * 3));
          let fraction = 1;
          if (profile === "LATE" && r() < 0.55) payDay = addDays(due, 8 + Math.floor(r() * 12));
          if (profile === "PARTIAL" && r() < 0.5) fraction = 0.6 + r() * 0.3;
          if (profile === "EVICTION" && monthsLeft < 3) payDay = null;
          // Late fees are assessed the day after the grace period if rent is still open.
          const feeDay = addDays(due, policy.graceDays + 1);
          if (payDay && payDay > feeDay && feeDay <= today) counts.lateFees += await assessLateFees(tx, a, leaseId, policy, feeDay, order);
          if (!payDay && feeDay <= today) counts.lateFees += await assessLateFees(tx, a, leaseId, policy, feeDay, order);
          if (payDay && payDay <= today && payDay <= stopAt) {
            const bal = await M.leaseBalance(tx, leaseId);
            const owed = bal.balanceCents > 0 ? bal.balanceCents : 0;
            const amount = fraction === 1 ? owed : Math.round((owed * fraction) / 100) * 100;
            if (amount > 0) {
              const method = commercial ? "ACH" : pick(["ACH", "ACH", "CHECK", "CARD"]);
              const p = await M.receivePayment(tx, a, { leaseId, amountCents: amount, date: payDay, method, reference: method === "CHECK" ? String(1000 + Math.floor(r() * 8999)) : null, order });
              if (profile === "NSF" && !nsfDone && monthsLeft === 4) {
                await M.returnPayment(tx, a, { paymentId: p.transaction.id, date: addDays(payDay, 4), nsfFeeCents: 3500, reason: "NSF", order });
                await M.receivePayment(tx, a, { leaseId, amountCents: amount + 3500, date: addDays(payDay, 9), method: "ACH", order });
                nsfDone = true;
                counts.returned++;
              }
            }
          }
          month = startOfMonth(addMonths(month, 1));
        }
      },
      { timeout: 300_000 },
    );
    if (moveOut) {
      await endLease(db, leaseId, { moveOutDate: toISODate(moveOut), reason: pick(["Relocating for work", "Bought a home", "Moving in with family"]), prorate: true }, today);
      await db.tx(async (tx) => {
        const bal = await M.leaseBalance(tx, leaseId);
        if (bal.balanceCents > 0) await M.receivePayment(tx, a, { leaseId, amountCents: bal.balanceCents, date: addDays(moveOut, 5), method: "CHECK", order });
        const held = await M.depositHeld(tx, leaseId);
        if (held > 0) await M.refund(tx, a, { leaseId, kind: "DEPOSIT", amountCents: held, date: addDays(moveOut, 20), memo: "Security deposit refund" });
      }, { timeout: 60_000 });
    }
    if (profile === "EVICTION") await setEviction(db, leaseId, true);
    leases++;
    profiles.push(profile);
    return leaseId;
  }

  let i = 0;
  for (const unit of leased) {
    i++;
    const profile: Profile = i === 13 ? "EVICTION" : i === 7 ? "NSF" : i % 6 === 0 ? "LATE" : i % 9 === 4 ? "PARTIAL" : "ONTIME";
    if (turnoverIds.has(unit.id)) {
      // Previous tenant: moved out mid-month 5–9 months ago; new tenant from the next month.
      const prevStart = addMonths(historyStart, Math.floor(r() * 2));
      const moveOut = utcDate(today.getUTCFullYear(), today.getUTCMonth() - 5 - Math.floor(r() * 4), 15);
      await simulate(unit, prevStart, addDays(addMonths(prevStart, 12), -1), "ONTIME", moveOut);
      const nextStart = startOfMonth(addMonths(moveOut, 1));
      await simulate(unit, nextStart, addDays(addMonths(nextStart, 12), -1), profile, null);
      continue;
    }
    // Start somewhere in the 18-month window (half at the very beginning for full history).
    const offset = r() < 0.5 ? 0 : Math.floor(r() * 14);
    const start = addMonths(historyStart, offset);
    const startDay = r() < 0.2 ? utcDate(start.getUTCFullYear(), start.getUTCMonth(), 15) : start;
    const fixed = r() < 0.85;
    // Spread end dates so the Expiring tab has leases ending in the next 30/60/90 days.
    const months = i % 5 === 0 ? 18 - offset : 12 + Math.floor(r() * 12);
    await simulate(unit, startDay, fixed ? addDays(addMonths(startOfMonth(startDay), months), -1) : null, profile, null);
  }
  await app.$disconnect();
  return { leases, ...counts };
}
