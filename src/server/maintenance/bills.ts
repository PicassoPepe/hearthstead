import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { postEntry } from "@/server/ledger/journal";
import { billLines } from "@/server/ledger/postings";
import { parseISODate } from "@/lib/dates";
import { addActivity, type TaskActor } from "./tasks";

export type BillInput = {
  vendorId: string;
  billNumber?: string;
  billDate: string;
  dueDate: string;
  memo?: string;
  lines: { accountId: string; amountCents: number; description?: string; propertyId?: string | null; unitId?: string | null }[];
  taskId?: string | null;
};

/** Create a bill and post it: Dr expense line(s) (with property/unit), Cr Accounts Payable. */
export async function createBill(db: ScopedDb, input: BillInput, actor?: TaskActor): Promise<{ id: string }> {
  if (!input.lines.length) throw new UserFacingError("Add at least one line");
  if (input.lines.some((l) => !Number.isSafeInteger(l.amountCents) || l.amountCents <= 0)) throw new UserFacingError("Every line needs an amount", { lines: "Enter amounts" });
  if (input.dueDate < input.billDate) throw new UserFacingError("The due date can't be before the bill date", { dueDate: "Before the bill date" });
  const vendor = await db.vendor.findFirst({ where: { id: input.vendorId } });
  if (!vendor) throw new UserFacingError("Choose a vendor", { vendorId: "Choose a vendor" });
  const accounts = await db.account.findMany({ where: { id: { in: input.lines.map((l) => l.accountId) } } });
  for (const l of input.lines) {
    const a = accounts.find((x) => x.id === l.accountId);
    if (!a || !["EXPENSE", "ASSET"].includes(a.type)) throw new UserFacingError("Bill lines post to expense (or asset) accounts", { lines: "Choose expense accounts" });
  }
  const props = [...new Set(input.lines.map((l) => l.propertyId).filter((x): x is string => !!x))];
  if (props.length && (await db.property.count({ where: { id: { in: props } } })) !== props.length) throw new UserFacingError("Choose valid properties");
  if (input.taskId) {
    const t = await db.task.findFirst({ where: { id: input.taskId } });
    if (!t) throw new UserFacingError("Work order not found");
    if (t.billId) throw new UserFacingError("This work order already has a bill.");
  }
  const total = input.lines.reduce((s, l) => s + l.amountCents, 0);
  const bill = await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, db.ctx.userId, {
      date: parseISODate(input.billDate),
      memo: `Bill ${input.billNumber ? `#${input.billNumber} ` : ""}— ${vendor.name}`,
      source: "BILL",
      lines: billLines(input.lines.map((l) => ({ account: { id: l.accountId }, amountCents: l.amountCents, dims: { propertyId: l.propertyId ?? null, unitId: l.unitId ?? null } }))),
    });
    const b = await tx.bill.create({
      data: {
        organizationId: db.ctx.orgId,
        vendorId: vendor.id,
        billNumber: input.billNumber || null,
        billDate: parseISODate(input.billDate),
        dueDate: parseISODate(input.dueDate),
        memo: input.memo || null,
        status: "OPEN",
        totalCents: total,
        journalEntryId: je.id,
        taskId: input.taskId ?? null,
        createdById: db.ctx.userId,
        lines: {
          create: input.lines.map((l) => ({ organizationId: db.ctx.orgId, accountId: l.accountId, amountCents: l.amountCents, description: l.description ?? null, propertyId: l.propertyId ?? null, unitId: l.unitId ?? null })),
        },
      },
    });
    await tx.journalEntry.update({ where: { id: je.id }, data: { sourceId: b.id } });
    if (input.taskId) await tx.task.update({ where: { id: input.taskId }, data: { billId: b.id } });
    return b;
  });
  if (input.taskId && actor) await addActivity(db, input.taskId, actor, "BILL", `Vendor invoice ${input.billNumber ? `#${input.billNumber} ` : ""}entered as a bill for $${(total / 100).toFixed(2)}`);
  await audit(db, { action: "bill.created", entityType: "Bill", entityId: bill.id, after: { vendor: vendor.name, total, taskId: input.taskId } });
  const { requestApprovalsForBill } = await import("@/server/accounting/approvals");
  await requestApprovalsForBill(db, bill.id);
  return { id: bill.id };
}
