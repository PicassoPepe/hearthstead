import Link from "next/link";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { AccountsManager } from "@/components/accounting/accounts-manager";

export const metadata = { title: "Chart of accounts" };

/** Balances use each type's normal side: assets/expenses debit, everything else credit. */
export default async function ChartOfAccountsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const [accounts, sums] = await Promise.all([
    ctx.db.account.findMany({ orderBy: { code: "asc" } }),
    ctx.db.journalLine.groupBy({ by: ["accountId"], _sum: { debitCents: true, creditCents: true } }),
  ]);
  const net = new Map(sums.map((s) => [s.accountId, (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0)]));
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Chart of accounts"
        description="Every balance here is computed from the journal — nothing is edited directly."
        actions={can(ctx.permissions, "accounting", "edit") ? <Button asChild variant="secondary"><Link href="/app/new/journal-entry" scroll={false}>New journal entry</Link></Button> : null}
      />
      <AccountsManager
        canEdit={can(ctx.permissions, "accounting", "edit")}
        accounts={accounts.map((a) => {
          const n = net.get(a.id) ?? 0;
          return { id: a.id, code: a.code, name: a.name, type: a.type, isBank: a.isBank, isSystem: a.isSystem, active: a.active, balanceCents: a.type === "ASSET" || a.type === "EXPENSE" ? n : -n || 0 };
        })}
      />
    </>
  );
}
