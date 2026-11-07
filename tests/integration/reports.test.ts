import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createLease } from "@/server/leasing/leases";
import * as M from "@/server/leasing/money";
import { saveVendor } from "@/server/maintenance/vendors";
import * as AP from "@/server/accounting/payables";
import { runReport } from "@/server/reports/engine";
import { normalizeParams } from "@/lib/reports";
import type { AppContext } from "@/server/context";
import { parseISODate as d } from "@/lib/dates";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let db: ScopedDb;
let ctx: AppContext;
let propertyId: string;
const today = d("2026-11-20");
const hl = (r: { highlights: { label: string; value: number }[] }, l: string) => r.highlights.find((h) => h.label === l)?.value;

beforeAll(async () => {
  A = await makeOrg("RP");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  ctx = { db, org: { id: A.orgId }, user: { id: A.userId }, membership: { propertyScope: [], roleKey: "ADMIN" }, permissions: {} } as unknown as AppContext;
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Report Flats", address: { addressLine1: "1 R St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 100_000 }, { name: "2", marketRentCents: 120_000 }], owners: [] })).id;
  const unit = (await db.unit.findFirstOrThrow({ where: { propertyId, name: "1" } })).id;
  const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
  const leaseId = (await createLease(db, { propertyId, unitIds: [unit], termType: "FIXED", startDate: "2026-11-01", endDate: "2027-01-15", rentDueDay: 1, tenants: [{ newTenant: { firstName: "Rae", lastName: "Port" }, role: "PRIMARY" }], recurring: [{ kind: "RENT", accountId: rent, description: "Rent", amountCents: 100_000 }], deposit: { amountCents: 50_000, handling: "CHARGE" } }, d("2026-11-01"))).id;
  await db.tx((tx) => M.receivePayment(tx, { orgId: A.orgId, userId: A.userId }, { leaseId, amountCents: 60_000, date: d("2026-11-05") }));
  const vendor = (await saveVendor(db, null, { name: "Fixer", trades: ["GENERAL"] })).id;
  const repairs = (await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } })).id;
  const bill = await AP.createBill(db, { vendorId: vendor, billDate: "2026-11-06", dueDate: "2026-11-30", lines: [{ accountId: repairs, amountCents: 20_000, propertyId }] });
  await AP.payBill(db, { billId: bill.id, amountCents: 5_000, date: "2026-11-10", bankAccountId: (await db.account.findFirstOrThrow({ where: { systemKey: "OPERATING_CASH" } })).id });
});
afterAll(async () => {
  await cleanup([A.orgId], [A.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("reports", () => {
  const P = (raw: Record<string, string>) => normalizeParams({ from: "2026-11-01", to: "2026-11-30", asOf: "2026-11-20", ...raw }, today);

  it("P&L accrual vs cash", async () => {
    const acc = await runReport(ctx, "profit-loss", P({}), today);
    expect(hl(acc, "Total income")).toBe(100_000); // rent charged (deposit is a liability)
    expect(hl(acc, "Total expenses")).toBe(20_000);
    const cash = await runReport(ctx, "profit-loss", P({ basis: "CASH" }), today);
    // $600 paid: applied oldest-first to the deposit charge ($500) then $100 rent → $100 rent income in cash.
    expect(hl(cash, "Total income")).toBe(10_000);
    expect(hl(cash, "Total expenses")).toBe(5_000);
    const byProp = await runReport(ctx, "profit-loss", P({ groupBy: "property" }), today);
    expect(byProp.columns.map((c) => c.label)).toContain("Report Flats");
  });

  it("balance sheet balances; rent roll, delinquency, deposits, vacancy agree", async () => {
    const bs = await runReport(ctx, "balance-sheet", P({}), today);
    expect(hl(bs, "Total assets")).toBe((hl(bs, "Total liabilities") ?? 0) + (hl(bs, "Total equity") ?? 0));
    const rr = await runReport(ctx, "rent-roll", P({}), today);
    expect(hl(rr, "Occupancy")).toBe(5000);
    expect(hl(rr, "Outstanding balances")).toBe(90_000);
    const del = await runReport(ctx, "delinquency", P({}), today);
    expect(hl(del, "Total owed")).toBe(90_000);
    const dep = await runReport(ctx, "deposits-held", P({}), today);
    expect(hl(dep, "Deposits held")).toBe(50_000);
    const vac = await runReport(ctx, "vacancy", P({}), today);
    expect(hl(vac, "Vacant units")).toBe(1);
    const exp = await runReport(ctx, "lease-expirations", normalizeParams({ from: "2026-11-20", to: "2027-02-20" }, today), today);
    expect(hl(exp, "Leases expiring")).toBe(1);
  });

  it("cash flow ties beginning + net to ending; GL running balance; 1099", async () => {
    const cf = await runReport(ctx, "cash-flow", P({}), today);
    expect(hl(cf, "Ending cash")).toBe(60_000 - 5_000);
    const gl = await runReport(ctx, "general-ledger", P({ accountId: (await db.account.findFirstOrThrow({ where: { systemKey: "ACCOUNTS_PAYABLE" } })).id }), today);
    expect(gl.rows.at(-1)?.cells.balance).toBe(15_000);
    const t = await runReport(ctx, "vendor-1099", normalizeParams({ year: "2026" }, today), today);
    expect(hl(t, "Total paid to vendors")).toBe(5_000);
    expect(hl(t, "Vendors needing a 1099")).toBe(0);
  });
});
