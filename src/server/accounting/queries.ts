import type { AppContext } from "@/server/context";
import { toISODate } from "@/lib/dates";
import { bankAccounts, billOpenCents } from "./payables";

export type BooksOptions = {
  vendors: { id: string; name: string; defaultExpenseAccountId: string | null }[];
  expenseAccounts: { id: string; label: string }[];
  banks: { id: string; label: string; purpose: string }[];
  properties: { id: string; name: string; units: number; sqft: number; unitList: { id: string; name: string }[] }[];
  today: string;
};

export async function booksOptions(ctx: AppContext): Promise<BooksOptions> {
  const [vendors, accounts, banks, props] = await Promise.all([
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, defaultExpenseAccountId: true } }),
    ctx.db.account.findMany({ where: { active: true, OR: [{ type: "EXPENSE" }, { type: "ASSET", isBank: false, systemKey: null }] }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    bankAccounts(ctx.db),
    ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, units: { where: { deletedAt: null }, select: { id: true, name: true, sqft: true }, orderBy: { name: "asc" } } } }),
  ]);
  return {
    vendors,
    expenseAccounts: accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
    banks: banks.map((b) => ({ id: b.id, label: `${b.code} · ${b.name}${b.mask ? ` ••${b.mask}` : ""}`, purpose: b.purpose })),
    properties: props.map((p) => ({ id: p.id, name: p.name, units: p.units.length, sqft: p.units.reduce((s, u) => s + (u.sqft ?? 0), 0), unitList: p.units.map((u) => ({ id: u.id, name: u.name })) })),
    today: toISODate(new Date()),
  };
}

export type BillRow = { id: string; number: string; vendor: string; vendorId: string; billDate: string; dueDate: string; totalCents: number; openCents: number; status: string; overdue: boolean; properties: string; memo: string };

export async function listBills(ctx: AppContext): Promise<BillRow[]> {
  const bills = await ctx.db.bill.findMany({
    orderBy: [{ dueDate: "desc" }],
    take: 1000,
    include: { vendor: { select: { name: true } }, lines: { select: { propertyId: true } } },
  });
  const [paid, credits, props] = await Promise.all([
    ctx.db.billPayment.groupBy({ by: ["billId"], where: { voidedAt: null, billId: { in: bills.map((b) => b.id) } }, _sum: { amountCents: true } }),
    ctx.db.vendorCredit.groupBy({ by: ["appliedToBillId"], where: { appliedToBillId: { in: bills.map((b) => b.id) } }, _sum: { amountCents: true } }),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ]);
  const pName = new Map(props.map((p) => [p.id, p.name]));
  const today = toISODate(new Date());
  return bills.map((b) => {
    const open = b.status === "VOID" ? 0 : b.totalCents - (paid.find((p) => p.billId === b.id)?._sum.amountCents ?? 0) - (credits.find((c) => c.appliedToBillId === b.id)?._sum.amountCents ?? 0);
    const due = toISODate(b.dueDate);
    return {
      id: b.id, number: b.billNumber ?? "—", vendor: b.vendor.name, vendorId: b.vendorId, billDate: toISODate(b.billDate), dueDate: due, totalCents: b.totalCents, openCents: open,
      status: b.status, overdue: open > 0 && due < today, memo: b.memo ?? "",
      properties: [...new Set(b.lines.map((l) => (l.propertyId ? pName.get(l.propertyId) ?? "" : "Company")))].join(", "),
    };
  });
}

export async function billDetail(ctx: AppContext, id: string) {
  const bill = await ctx.db.bill.findFirst({ where: { id }, include: { vendor: true, lines: true } });
  if (!bill) return null;
  const [payments, credits, accounts, props, task, openCredits] = await Promise.all([
    ctx.db.billPayment.findMany({ where: { billId: id }, orderBy: { date: "asc" } }),
    ctx.db.vendorCredit.findMany({ where: { appliedToBillId: id } }),
    ctx.db.account.findMany({ select: { id: true, code: true, name: true } }),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
    bill.taskId ? ctx.db.task.findFirst({ where: { id: bill.taskId }, select: { id: true, number: true, title: true } }) : null,
    ctx.db.vendorCredit.findMany({ where: { vendorId: bill.vendorId, appliedToBillId: null } }),
  ]);
  const acct = (i: string) => accounts.find((a) => a.id === i);
  return {
    bill,
    openCents: await billOpenCents(ctx.db, id),
    lines: bill.lines.map((l) => ({ id: l.id, account: `${acct(l.accountId)?.code} · ${acct(l.accountId)?.name}`, description: l.description, property: props.find((p) => p.id === l.propertyId)?.name ?? null, amountCents: l.amountCents })),
    payments: payments.map((p) => ({ id: p.id, date: toISODate(p.date), amountCents: p.amountCents, method: p.method, reference: p.reference, bank: acct(p.bankAccountId)?.name ?? "", voided: !!p.voidedAt })),
    credits: credits.map((c) => ({ id: c.id, date: toISODate(c.date), amountCents: c.amountCents, memo: c.memo })),
    openCredits: openCredits.map((c) => ({ id: c.id, date: toISODate(c.date), amountCents: c.amountCents, memo: c.memo })),
    task,
  };
}
