import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { postEntry } from "@/server/ledger/journal";
import { contributionLines, distributionLines } from "@/server/ledger/postings";
import { allocateCents } from "@/lib/money";
import { addMonths, endOfMonth, parseISODate, periodOf, toISODate, utcDate } from "@/lib/dates";
import { managementFee } from "@/lib/accounting";
import { createBill, payBill } from "./payables";

export type PropertyCash = {
  propertyId: string;
  property: string;
  bankCents: number;
  undepositedCents: number;
  prepaidCents: number;
  payablesCents: number;
  reserveCents: number;
  availableCents: number;
  owners: { ownerId: string; name: string; percentBps: number; shareCents: number }[];
};

const ownerName = (o: { kind: string; firstName: string | null; lastName: string | null; companyName: string | null }) =>
  o.kind === "COMPANY" ? o.companyName ?? "Owner" : [o.firstName, o.lastName].filter(Boolean).join(" ") || o.companyName || "Owner";

/**
 * Cash available to distribute per property, straight from the ledger:
 *   operating bank cash + undeposited funds − prepaid rent − open payables − reserve.
 * Security-deposit cash is never available. Each owner's share follows ownership %.
 */
export async function availableCash(db: ScopedDb, propertyIds?: string[]): Promise<PropertyCash[]> {
  const props = await db.property.findMany({
    where: propertyIds ? { id: { in: propertyIds } } : {},
    orderBy: { name: "asc" },
    include: { ownerships: { where: { deletedAt: null }, include: { owner: true }, orderBy: { percentBps: "desc" } } },
  });
  const accts = await db.account.findMany({ where: { OR: [{ isBank: true }, { systemKey: { in: ["UNDEPOSITED_FUNDS", "PREPAID_RENT", "ACCOUNTS_PAYABLE"] } }] }, include: { bankAccount: true } });
  const operating = accts.filter((a) => a.isBank && a.bankAccount?.purpose !== "SECURITY_DEPOSIT" && a.systemKey !== "DEPOSIT_CASH").map((a) => a.id);
  const key = (k: string) => accts.find((a) => a.systemKey === k)!.id;
  const sums = await db.journalLine.groupBy({
    by: ["accountId", "propertyId"],
    where: { propertyId: { in: props.map((p) => p.id) }, accountId: { in: [...operating, key("UNDEPOSITED_FUNDS"), key("PREPAID_RENT"), key("ACCOUNTS_PAYABLE")] } },
    _sum: { debitCents: true, creditCents: true },
  });
  const net = (propertyId: string, ids: string[]) => sums.filter((s) => s.propertyId === propertyId && ids.includes(s.accountId)).reduce((t, s) => t + (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0), 0);
  return props.map((p) => {
    const bankCents = net(p.id, operating);
    const undepositedCents = net(p.id, [key("UNDEPOSITED_FUNDS")]);
    const prepaidCents = -net(p.id, [key("PREPAID_RENT")]);
    const payablesCents = -net(p.id, [key("ACCOUNTS_PAYABLE")]);
    const availableCents = Math.max(0, bankCents + undepositedCents - prepaidCents - Math.max(0, payablesCents) - p.reserveCents);
    const shares = p.ownerships.length ? allocateCents(availableCents, p.ownerships.map((o) => o.percentBps)) : [];
    return {
      propertyId: p.id, property: p.name, bankCents, undepositedCents, prepaidCents, payablesCents, reserveCents: p.reserveCents, availableCents,
      owners: p.ownerships.map((o, i) => ({ ownerId: o.ownerId, name: ownerName(o.owner), percentBps: o.percentBps, shareCents: shares[i] ?? 0 })),
    };
  });
}

async function defaultBank(db: ScopedDb, propertyId: string) {
  const p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
  return p.defaultOperatingAccountId ?? (await db.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id;
}

/** Pay out owner distributions. `amounts` per owner; omitted owners get nothing. */
export async function distribute(db: ScopedDb, input: { propertyId: string; date: string; bankAccountId?: string; method?: string; memo?: string; amounts: { ownerId: string; amountCents: number }[] }) {
  const [cash] = await availableCash(db, [input.propertyId]);
  if (!cash) throw new UserFacingError("Property not found");
  const amounts = input.amounts.filter((a) => a.amountCents > 0);
  if (!amounts.length) throw new UserFacingError("Nothing to distribute");
  for (const a of amounts) {
    if (!Number.isSafeInteger(a.amountCents)) throw new UserFacingError("Amounts must be whole cents");
    if (!cash.owners.some((o) => o.ownerId === a.ownerId)) throw new UserFacingError("That owner doesn't own this property");
  }
  const total = amounts.reduce((s, a) => s + a.amountCents, 0);
  if (total > cash.availableCents) throw new UserFacingError(`Only ${(cash.availableCents / 100).toFixed(2)} is available after reserves and payables`);
  const bankId = input.bankAccountId ?? (await defaultBank(db, input.propertyId));
  if (!(await db.account.findFirst({ where: { id: bankId, isBank: true } }))) throw new UserFacingError("Choose a bank account");
  const rows = await db.tx(async (tx) => {
    const out = [];
    for (const a of amounts) {
      const owner = cash.owners.find((o) => o.ownerId === a.ownerId)!;
      const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, { date: parseISODate(input.date), memo: `Owner distribution — ${owner.name} · ${cash.property}`, source: "OWNER_DISTRIBUTION", lines: distributionLines(a.amountCents, { id: bankId }, { propertyId: input.propertyId }) });
      const d = await tx.ownerDistribution.create({ data: { organizationId: db.ctx.orgId, ownerId: a.ownerId, propertyId: input.propertyId, kind: "DISTRIBUTION", amountCents: a.amountCents, date: parseISODate(input.date), bankAccountId: bankId, method: input.method ?? "ACH", memo: input.memo || null, journalEntryId: je.id, createdById: db.ctx.userId } });
      await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: d.id } });
      out.push(d);
    }
    return out;
  });
  await audit(db, { action: "owner.distribution", entityType: "Property", entityId: input.propertyId, after: { total, owners: amounts.length } });
  return { count: rows.length, totalCents: total };
}

/** Distribute everything available, split by ownership, for each property given. */
export async function distributeAll(db: ScopedDb, input: { propertyIds: string[]; date: string; method?: string }) {
  let count = 0;
  let totalCents = 0;
  for (const c of await availableCash(db, input.propertyIds)) {
    const amounts = c.owners.map((o) => ({ ownerId: o.ownerId, amountCents: o.shareCents })).filter((a) => a.amountCents > 0);
    if (!amounts.length) continue;
    const r = await distribute(db, { propertyId: c.propertyId, date: input.date, method: input.method, amounts });
    count += r.count;
    totalCents += r.totalCents;
  }
  return { count, totalCents };
}

export async function recordContribution(db: ScopedDb, input: { propertyId: string; ownerId: string; amountCents: number; date: string; bankAccountId?: string; memo?: string }) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new UserFacingError("Enter an amount", { amountCents: "Enter an amount" });
  const own = await db.propertyOwnership.findFirst({ where: { propertyId: input.propertyId, ownerId: input.ownerId }, include: { owner: true, property: true } });
  if (!own) throw new UserFacingError("That owner doesn't own this property");
  const bankId = input.bankAccountId ?? (await defaultBank(db, input.propertyId));
  const d = await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, { date: parseISODate(input.date), memo: `Owner contribution — ${ownerName(own.owner)} · ${own.property.name}`, source: "OWNER_CONTRIBUTION", lines: contributionLines(input.amountCents, { id: bankId }, { propertyId: input.propertyId }) });
    const row = await tx.ownerDistribution.create({ data: { organizationId: db.ctx.orgId, ownerId: input.ownerId, propertyId: input.propertyId, kind: "CONTRIBUTION", amountCents: input.amountCents, date: parseISODate(input.date), bankAccountId: bankId, method: "ACH", memo: input.memo || null, journalEntryId: je.id, createdById: db.ctx.userId } });
    await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: row.id } });
    return row;
  });
  await audit(db, { action: "owner.contribution", entityType: "Property", entityId: input.propertyId, after: { amountCents: input.amountCents, ownerId: input.ownerId } });
  return d;
}

// ---------------------------------------------------------------- management fees

export type FeeRuleInput = { propertyId: string | null; type: "PERCENT" | "FLAT"; percentBps: number; flatCents: number; minimumCents: number; basis: "COLLECTED_RENT" | "COLLECTED_INCOME" };

export async function saveFeeRules(db: ScopedDb, rules: FeeRuleInput[]) {
  for (const r of rules) {
    if (r.type === "PERCENT" && (!Number.isInteger(r.percentBps) || r.percentBps < 0 || r.percentBps > 5000)) throw new UserFacingError("Percent must be 0–50%");
    if (![r.flatCents, r.minimumCents].every((c) => Number.isSafeInteger(c) && c >= 0)) throw new UserFacingError("Amounts must be positive");
  }
  if (rules.filter((r) => r.propertyId === null).length !== 1) throw new UserFacingError("Set exactly one company default");
  const props = rules.map((r) => r.propertyId).filter((x): x is string => !!x);
  if (new Set(props).size !== props.length) throw new UserFacingError("Each property can only have one override");
  if (props.length && (await db.property.count({ where: { id: { in: props } } })) !== props.length) throw new UserFacingError("Choose valid properties");
  await db.tx(async (tx) => {
    await tx.managementFeeRule.deleteMany({ where: {} });
    for (const r of rules) await tx.managementFeeRule.create({ data: { organizationId: db.ctx.orgId, ...r, createdById: db.ctx.userId } });
  });
  await audit(db, { action: "management_fees.rules_saved", entityType: "Organization", entityId: db.ctx.orgId, after: { rules } });
}

/** Collected rent (payments applied to RENT charges) or all collected income for a property in a month. */
export async function feeBasis(db: ScopedDb, propertyId: string, period: string, basis: string): Promise<number> {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const from = utcDate(y, m - 1, 1);
  const to = endOfMonth(from);
  if (basis === "COLLECTED_INCOME") {
    const pays = await db.leaseTransaction.findMany({ where: { type: "PAYMENT", voidedAt: null, date: { gte: from, lte: to }, lease: { propertyId } }, select: { id: true, amountCents: true } });
    const returned = new Set((await db.leaseTransaction.findMany({ where: { type: "RETURNED_PAYMENT", voidedAt: null, relatedId: { in: pays.map((p) => p.id) } }, select: { relatedId: true } })).map((r) => r.relatedId));
    return pays.filter((p) => !returned.has(p.id)).reduce((s, p) => s + p.amountCents, 0);
  }
  const s = await db.paymentApplication.aggregate({
    where: { charge: { chargeKind: "RENT", lease: { propertyId } }, source: { type: "PAYMENT", voidedAt: null, date: { gte: from, lte: to } } },
    _sum: { amountCents: true },
  });
  return s._sum.amountCents ?? 0;
}

async function managementVendor(db: ScopedDb) {
  const org = await db.organization.findFirstOrThrow({ where: { id: db.ctx.orgId } });
  const name = `${org.name} — management`;
  const v = await db.vendor.findFirst({ where: { name } });
  if (v) return v;
  const fees = await db.account.findFirstOrThrow({ where: { systemKey: "MANAGEMENT_FEES" } });
  return db.vendor.create({ data: { organizationId: db.ctx.orgId, name, trades: [], send1099: false, defaultExpenseAccountId: fees.id, createdById: db.ctx.userId } });
}

/**
 * Charge each property its management fee for `period` (YYYY-MM): a bill from the management
 * company, paid from the property's operating account. Idempotent per (property, period).
 */
export async function runManagementFees(db: ScopedDb, period: string, opts: { autopay?: boolean } = {}) {
  const rules = await db.managementFeeRule.findMany();
  const fallback = rules.find((r) => r.propertyId === null);
  if (!fallback) return { created: 0, totalCents: 0, skipped: 0 };
  const [y, m] = period.split("-").map(Number) as [number, number];
  const billDate = endOfMonth(utcDate(y, m - 1, 1));
  const fees = await db.account.findFirstOrThrow({ where: { systemKey: "MANAGEMENT_FEES" } });
  const vendor = await managementVendor(db);
  const props = await db.property.findMany({ select: { id: true, name: true } });
  let created = 0;
  let skipped = 0;
  let totalCents = 0;
  for (const p of props) {
    if (await db.managementFeeRun.findFirst({ where: { propertyId: p.id, period } })) { skipped++; continue; }
    const rule = rules.find((r) => r.propertyId === p.id) ?? fallback;
    const basisCents = await feeBasis(db, p.id, period, rule.basis);
    const feeCents = managementFee(rule, basisCents);
    let run;
    try {
      run = await db.managementFeeRun.create({ data: { organizationId: db.ctx.orgId, propertyId: p.id, period, feeCents, basisCents } });
    } catch {
      skipped++;
      continue; // a concurrent run already took this period
    }
    if (feeCents <= 0) continue;
    const bill = await createBill(db, { vendorId: vendor.id, billNumber: `MGMT-${period}`, billDate: toISODate(billDate), dueDate: toISODate(billDate), memo: `Management fee ${period} — ${p.name}`, lines: [{ accountId: fees.id, amountCents: feeCents, propertyId: p.id, description: rule.type === "PERCENT" ? `${rule.percentBps / 100}% of ${(basisCents / 100).toFixed(2)}` : "Flat fee" }] });
    await db.managementFeeRun.update({ where: { id: run.id }, data: { billId: bill.id } });
    if (opts.autopay ?? true) await payBill(db, { billId: bill.id, date: toISODate(billDate), bankAccountId: await defaultBank(db, p.id), method: "TRANSFER", reference: `MGMT-${period}` });
    created++;
    totalCents += feeCents;
  }
  await audit(db, { action: "management_fees.run", entityType: "Organization", entityId: db.ctx.orgId, after: { period, created, totalCents } });
  return { created, totalCents, skipped };
}

/** The last fully-finished month before `today`. */
export const previousPeriod = (today: Date) => periodOf(addMonths(utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1), -1));
