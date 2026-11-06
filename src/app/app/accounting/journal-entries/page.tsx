import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { JournalList } from "@/components/accounting/journal-list";

export const metadata = { title: "Journal entries" };

export default async function JournalEntriesPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "accounting", "view")) return <Forbidden what="accounting" />;
  const entries = await ctx.db.journalEntry.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { lines: { include: { account: true } }, reversedBy: { select: { id: true } } },
  });
  const props = new Map((await ctx.db.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Journal entries"
        description="Every posting, balanced. Lease activity posts automatically; use a manual entry for adjustments."
        actions={can(ctx.permissions, "accounting", "edit") ? <Button asChild><Link href="/app/new/journal-entry" scroll={false}><Plus aria-hidden /> New journal entry</Link></Button> : null}
      />
      <JournalList
        canVoid={can(ctx.permissions, "accounting", "delete")}
        entries={entries.map((e) => ({
          id: e.id,
          date: e.date.toISOString().slice(0, 10),
          memo: e.memo ?? "",
          source: e.source,
          totalCents: e.lines.reduce((s, l) => s + l.debitCents, 0),
          reversed: Boolean(e.reversedBy),
          isReversal: Boolean(e.reversesId),
          lines: e.lines.map((l) => ({ account: `${l.account.code} · ${l.account.name}`, debitCents: l.debitCents, creditCents: l.creditCents, property: l.propertyId ? (props.get(l.propertyId) ?? null) : null })),
        }))}
      />
    </>
  );
}
