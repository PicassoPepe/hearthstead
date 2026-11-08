import { ClipboardList as ClipboardListIcon } from "lucide-react";
import Link from "next/link";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ScreeningResult } from "@/adapters/screening";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Applications" };

const TABS = [["review", "To review"], ["APPROVED", "Approved"], ["DECLINED", "Declined"], ["DRAFT", "In progress"], ["all", "All"]] as const;
const REC_TONE = { ACCEPT: "success", CONDITIONAL: "warning", DECLINE: "danger" } as const;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "review";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="applications" />;
  const where = tab === "review" ? { status: { in: ["SUBMITTED", "SCREENING"] } } : tab === "all" ? {} : { status: tab };
  const [apps, counts, props, units, listings] = await Promise.all([
    ctx.db.application.findMany({ where: { deletedAt: null, ...where }, orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }], take: 300 }),
    ctx.db.application.groupBy({ by: ["status"], _count: true }),
    ctx.db.property.findMany({ select: { id: true, name: true } }),
    ctx.db.unit.findMany({ select: { id: true, name: true } }),
    ctx.db.listing.findMany({ select: { id: true, rentCents: true } }),
  ]);
  const n = (s: string[]) => counts.filter((c) => s.includes(c.status)).reduce((t, c) => t + c._count, 0);
  return (
    <>
      <PageHeader icon={<ClipboardListIcon aria-hidden />} eyebrow="Leasing" title="Applications" description="Applicants apply online from your listings. Screening runs automatically on submit." />
      <nav aria-label="Application status" className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/app/leasing/applications?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-sm", tab === k ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
            {l}{k === "review" ? ` (${n(["SUBMITTED", "SCREENING"])})` : k !== "all" ? ` (${n([k])})` : ""}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Applications</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["#", "Applicant", "Home", "Move-in", "Income / rent", "Screening", "Status", "Submitted"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {apps.map((a) => {
              const s = a.screening as ScreeningResult | null;
              const rent = listings.find((l) => l.id === a.listingId)?.rentCents;
              return (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 tabular">{a.number}</td>
                  <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/app/leasing/applications/${a.id}`}>{`${a.firstName} ${a.lastName}`.trim() || a.email}</Link><div className="text-xs text-muted-foreground">{a.email}{a.role !== "PRIMARY" ? ` · ${a.role === "GUARANTOR" ? "guarantor" : "co-applicant"}` : ""}</div></td>
                  <td className="px-3 py-2">{props.find((p) => p.id === a.propertyId)?.name}{a.unitId ? ` · ${units.find((u) => u.id === a.unitId)?.name}` : ""}{rent ? <div className="text-xs text-muted-foreground">{formatMoney(rent)}/mo</div> : null}</td>
                  <td className="px-3 py-2">{a.desiredMoveIn ? formatDate(a.desiredMoveIn) : "—"}</td>
                  <td className="px-3 py-2 tabular">{s?.incomeToRent ? `${s.incomeToRent}×` : "—"}</td>
                  <td className="px-3 py-2">{s ? <Badge tone={REC_TONE[s.recommendation]}>{s.recommendation === "ACCEPT" ? "Meets criteria" : s.recommendation === "CONDITIONAL" ? "Review" : "Doesn't meet"}{s.creditScore ? ` · ${s.creditScore}` : ""}</Badge> : "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.status} label={a.status === "DRAFT" ? `In progress (step ${a.step + 1})` : undefined} /></td>
                  <td className="px-3 py-2">{a.submittedAt ? formatDate(a.submittedAt) : "—"}</td>
                </tr>
              );
            })}
            {!apps.length ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nothing here. Share a listing link so people can apply.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
