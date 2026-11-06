import { notFound } from "next/navigation";
import { NAV_MAIN } from "@/lib/nav";
import { ComingSoon } from "@/components/patterns/coming-soon";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { Forbidden } from "@/components/patterns/forbidden";

const DESCRIPTIONS: Record<string, string> = {
  rentals: "Properties, units, owners, the New Property wizard and the CSV importer.",
  leasing: "Leases, the New Lease wizard, recurring charges, late fees and the lease ledger.",
  people: "Tenants, owners, vendors and prospects, each with a full profile.",
  accounting: "Chart of accounts, banking, reconciliation, bills, distributions and management fees.",
  tasks: "Tasks, tenant requests, work orders and inspections — table and board views.",
  communications: "Announcements, a unified SMS + portal inbox and communication logs.",
  reports: "Rent roll, delinquency, P&L, balance sheet, owner statements and more.",
  notes: "Notes attached to any property, lease or person.",
  files: "File library, CSV/XLSX importer, document templates and e-signature tracking.",
  workflows: "Trigger → condition → action automations with run history.",
  ai: "An assistant grounded on your data, with confirmation and audit for every write.",
};

/** Sections that land in later phases render a "coming in Phase N" state instead of a 404. */
export default async function SectionPlaceholder({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const path = `/app/${section.join("/")}`;
  for (const s of NAV_MAIN) {
    const leaf = s.children?.find((c) => c.href === path);
    if (s.href === path || leaf) {
      const ctx = await requireContext();
      if (s.module && !can(ctx.permissions, s.module, "view")) return <Forbidden what={s.label} />;
      return (
        <ComingSoon
          title={leaf && leaf.href !== s.href ? `${s.label} · ${leaf.label}` : s.label}
          phase={leaf?.phase ?? s.phase ?? 2}
          description={DESCRIPTIONS[s.id] ?? ""}
        />
      );
    }
  }
  notFound();
}
