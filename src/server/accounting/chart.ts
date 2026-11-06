import type { AccountType, Prisma, PrismaClient } from "@prisma/client";

/**
 * The default chart of accounts every organization starts with. `systemKey` accounts are
 * referenced by the ledger (Phase 3) and cannot be renamed or deleted.
 */
export type ChartAccount = { code: string; name: string; type: AccountType; isBank?: boolean; systemKey?: string };

export const DEFAULT_CHART: ChartAccount[] = [
  // Assets
  { code: "1000", name: "Operating Cash", type: "ASSET", isBank: true, systemKey: "OPERATING_CASH" },
  { code: "1010", name: "Security Deposit Cash", type: "ASSET", isBank: true, systemKey: "DEPOSIT_CASH" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET", systemKey: "ACCOUNTS_RECEIVABLE" },
  { code: "1150", name: "Undeposited Funds", type: "ASSET", systemKey: "UNDEPOSITED_FUNDS" },
  { code: "1200", name: "Prepaid Expenses", type: "ASSET" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "LIABILITY", systemKey: "ACCOUNTS_PAYABLE" },
  { code: "2100", name: "Security Deposits Held", type: "LIABILITY", systemKey: "DEPOSITS_HELD" },
  { code: "2200", name: "Prepaid Rent", type: "LIABILITY", systemKey: "PREPAID_RENT" },
  { code: "2300", name: "Sales Tax Payable", type: "LIABILITY" },
  // Equity
  { code: "3000", name: "Owner Equity", type: "EQUITY", systemKey: "OWNER_EQUITY" },
  { code: "3100", name: "Owner Contributions", type: "EQUITY", systemKey: "OWNER_CONTRIBUTIONS" },
  { code: "3200", name: "Owner Distributions", type: "EQUITY", systemKey: "OWNER_DISTRIBUTIONS" },
  { code: "3900", name: "Retained Earnings", type: "EQUITY", systemKey: "RETAINED_EARNINGS" },
  { code: "3950", name: "Opening Balance Equity", type: "EQUITY", systemKey: "OPENING_BALANCE_EQUITY" },
  // Income
  { code: "4000", name: "Rent Income", type: "INCOME", systemKey: "RENT_INCOME" },
  { code: "4100", name: "Late Fee Income", type: "INCOME", systemKey: "LATE_FEE_INCOME" },
  { code: "4200", name: "Other Income", type: "INCOME", systemKey: "OTHER_INCOME" },
  { code: "4300", name: "Management Fee Income", type: "INCOME", systemKey: "MANAGEMENT_FEE_INCOME" },
  { code: "4400", name: "Application Fee Income", type: "INCOME", systemKey: "APPLICATION_FEE_INCOME" },
  { code: "4500", name: "NSF Fee Income", type: "INCOME", systemKey: "NSF_FEE_INCOME" },
  { code: "4600", name: "Utility Reimbursement", type: "INCOME" },
  // Expenses
  { code: "5000", name: "Repairs & Maintenance", type: "EXPENSE", systemKey: "REPAIRS" },
  { code: "5100", name: "Utilities", type: "EXPENSE", systemKey: "UTILITIES" },
  { code: "5200", name: "Insurance", type: "EXPENSE", systemKey: "INSURANCE" },
  { code: "5300", name: "Property Taxes", type: "EXPENSE", systemKey: "TAXES" },
  { code: "5400", name: "Management Fees", type: "EXPENSE", systemKey: "MANAGEMENT_FEES" },
  { code: "5500", name: "Landscaping", type: "EXPENSE" },
  { code: "5600", name: "Cleaning & Turnover", type: "EXPENSE" },
  { code: "5700", name: "Legal & Professional", type: "EXPENSE" },
  { code: "5800", name: "Advertising", type: "EXPENSE" },
  { code: "5900", name: "Bank Fees", type: "EXPENSE" },
  { code: "5950", name: "HOA Dues", type: "EXPENSE" },
];

type Tx = Prisma.TransactionClient | PrismaClient;

/** Idempotently create the default chart (and bank-account records) for an organization. */
export async function provisionChart(tx: Tx, orgId: string, createdById?: string | null): Promise<void> {
  const existing = new Set((await tx.account.findMany({ where: { organizationId: orgId }, select: { code: true } })).map((a) => a.code));
  for (const a of DEFAULT_CHART) {
    if (existing.has(a.code)) continue;
    const acct = await tx.account.create({
      data: {
        organizationId: orgId,
        code: a.code,
        name: a.name,
        type: a.type,
        isBank: a.isBank ?? false,
        isSystem: Boolean(a.systemKey),
        systemKey: a.systemKey ?? null,
        createdById: createdById ?? null,
      },
    });
    if (a.isBank) {
      await tx.bankAccount.create({
        data: {
          organizationId: orgId,
          accountId: acct.id,
          purpose: a.systemKey === "DEPOSIT_CASH" ? "SECURITY_DEPOSIT" : "OPERATING",
          createdById: createdById ?? null,
        },
      });
    }
  }
}
