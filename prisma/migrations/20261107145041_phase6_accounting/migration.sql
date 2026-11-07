-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "reconciliationId" TEXT;

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CHECK',
    "reference" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "memo" TEXT,
    "lines" JSONB NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "dueDays" INTEGER NOT NULL DEFAULT 15,
    "nextRunDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RecurringBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBillRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recurringBillId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringBillRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT,
    "payee" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'DEBIT_CARD',
    "reference" TEXT,
    "memo" TEXT,
    "totalCents" INTEGER NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT,
    "propertyId" TEXT,
    "unitId" TEXT,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCredit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT,
    "memo" TEXT,
    "appliedToBillId" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "VendorCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "memo" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "leaseTransactionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "DepositItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedLineId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementDate" DATE NOT NULL,
    "statementBalanceCents" INTEGER NOT NULL,
    "openingBalanceCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerDistribution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DISTRIBUTION',
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'ACH',
    "memo" TEXT,
    "journalEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "OwnerDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementFeeRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PERCENT',
    "percentBps" INTEGER NOT NULL DEFAULT 800,
    "flatCents" INTEGER NOT NULL DEFAULT 0,
    "minimumCents" INTEGER NOT NULL DEFAULT 0,
    "basis" TEXT NOT NULL DEFAULT 'COLLECTED_RENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ManagementFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementFeeRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "basisCents" INTEGER NOT NULL,
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementFeeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_journalEntryId_key" ON "BillPayment"("journalEntryId");

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_billId_idx" ON "BillPayment"("organizationId", "billId");

-- CreateIndex
CREATE INDEX "RecurringBill_organizationId_nextRunDate_idx" ON "RecurringBill"("organizationId", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringBillRun_recurringBillId_period_key" ON "RecurringBillRun"("recurringBillId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_journalEntryId_key" ON "Expense"("journalEntryId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_date_idx" ON "Expense"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCredit_journalEntryId_key" ON "VendorCredit"("journalEntryId");

-- CreateIndex
CREATE INDEX "VendorCredit_organizationId_vendorId_idx" ON "VendorCredit"("organizationId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_journalEntryId_key" ON "Deposit"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositItem_leaseTransactionId_key" ON "DepositItem"("leaseTransactionId");

-- CreateIndex
CREATE INDEX "BankTransaction_organizationId_bankAccountId_status_idx" ON "BankTransaction"("organizationId", "bankAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_externalId_key" ON "BankTransaction"("bankAccountId", "externalId");

-- CreateIndex
CREATE INDEX "Reconciliation_organizationId_bankAccountId_idx" ON "Reconciliation"("organizationId", "bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerDistribution_journalEntryId_key" ON "OwnerDistribution"("journalEntryId");

-- CreateIndex
CREATE INDEX "OwnerDistribution_organizationId_ownerId_idx" ON "OwnerDistribution"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "OwnerDistribution_organizationId_propertyId_idx" ON "OwnerDistribution"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementFeeRule_organizationId_propertyId_key" ON "ManagementFeeRule"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementFeeRun_propertyId_period_key" ON "ManagementFeeRun"("propertyId", "period");

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositItem" ADD CONSTRAINT "DepositItem_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
