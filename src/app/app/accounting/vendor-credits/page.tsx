import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { VendorCreditsView } from "@/components/books/payables-views";
import { listBills } from "@/server/accounting/queries";
import { formatMoney } from "@/lib/money";
import { toISODate } from "@/lib/dates";

export const metadata = { title: "Vendor credits" };

export default async function VendorCreditsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [credits, vendors, accounts, props, bills] = await Promise.all([
    ctx.db.vendorCredit.findMany({ orderBy: { date: "desc" } }),
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.account.findMany({ where: { type: "EXPENSE", active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listBills(ctx),
  ]);
  const vn = new Map(vendors.map((v) => [v.id, v.name]));
  return (
    <>
      <PageHeader eyebrow="Accounting" title="Vendor credits" description="Refunds and credit memos. Apply a credit to an open bill to reduce what you pay." />
      <VendorCreditsView
        canEdit={can(ctx.permissions, "accounting", "edit")}
        today={toISODate(new Date())}
        vendors={vendors}
        properties={props}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
        openBills={bills.filter((b) => b.openCents > 0).map((b) => ({ id: b.id, vendorId: b.vendorId, label: `${b.number} · ${formatMoney(b.openCents)} open · due ${b.dueDate}` }))}
        rows={credits.map((c) => {
          const b = bills.find((x) => x.id === c.appliedToBillId);
          return {
            id: c.id, date: toISODate(c.date), vendor: vn.get(c.vendorId) ?? "", amountCents: c.amountCents,
            account: accounts.find((a) => a.id === c.accountId)?.name ?? "", property: props.find((p) => p.id === c.propertyId)?.name ?? "—",
            memo: c.memo ?? "", appliedTo: b ? `Bill ${b.number}` : null, appliedBillId: c.appliedToBillId,
          };
        })}
      />
    </>
  );
}
