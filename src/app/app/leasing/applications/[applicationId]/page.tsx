import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApplicationActions } from "@/components/funnel/application-actions";
import { applicationDataSchema, incomeOf } from "@/server/funnel/applications";
import type { ScreeningResult } from "@/adapters/screening";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Application" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 border-t border-border py-1.5 first:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v || "—"}</dd></div>;
}

export default async function ApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "leasing", "view")) return <Forbidden what="applications" />;
  const a = await ctx.db.application.findFirst({ where: { id: applicationId } });
  if (!a) notFound();
  const [property, unit, listing] = await Promise.all([
    ctx.db.property.findFirst({ where: { id: a.propertyId } }),
    a.unitId ? ctx.db.unit.findFirst({ where: { id: a.unitId } }) : null,
    a.listingId ? ctx.db.listing.findFirst({ where: { id: a.listingId } }) : null,
  ]);
  const d = applicationDataSchema.parse(a.data);
  const s = a.screening as ScreeningResult | null;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/app/leasing/applications" className="hover:underline">← Applications</Link>}
        title={`#${a.number} · ${`${a.firstName} ${a.lastName}`.trim() || a.email}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} /> {property?.name}{unit ? ` · ${unit.name}` : ""}{listing ? ` · ${formatMoney(listing.rentCents)}/mo` : ""}{a.submittedAt ? ` · submitted ${formatDate(a.submittedAt)}` : ""}</span>}
        actions={can(ctx.permissions, "leasing", "edit") ? <ApplicationActions id={a.id} status={a.status} leaseId={a.leaseId} suggestedReasons={s?.reasons.join("; ") ?? ""} /> : null}
      />
      {a.decisionReason ? <p className="mb-4 rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground">Declined: {a.decisionReason}</p> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Screening</CardTitle></CardHeader>
          <CardContent>
            {s ? (
              <dl className="text-sm">
                <Row k="Recommendation" v={<Badge tone={s.recommendation === "ACCEPT" ? "success" : s.recommendation === "CONDITIONAL" ? "warning" : "danger"}>{s.recommendation === "ACCEPT" ? "Meets criteria" : s.recommendation === "CONDITIONAL" ? "Review needed" : "Doesn't meet criteria"}</Badge>} />
                <Row k="Credit score" v={s.creditScore ?? "No credit file"} />
                <Row k="Income to rent" v={s.incomeToRent ? `${s.incomeToRent}×` : null} />
                <Row k="Eviction search" v={s.eviction === "CLEAR" ? "Clear" : "Records found"} />
                <Row k="Criminal search" v={s.criminal === "CLEAR" ? "Clear" : "Records found"} />
                <Row k="Report" v={`${s.provider} · ${s.reportId}`} />
                {s.reasons.length ? <div className="mt-2 rounded-lg bg-warning-soft p-2 text-xs text-warning-soft-foreground"><ul className="list-disc pl-4">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div> : null}
              </dl>
            ) : <p className="text-sm text-muted-foreground">Runs when the applicant submits.</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Application</CardTitle></CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <dl className="text-sm"><h3 className="mb-1 font-medium">Applicant</h3>
              <Row k="Email" v={a.email} /><Row k="Phone" v={d.about.phone} /><Row k="Date of birth" v={d.about.dob ? "On file" : null} /><Row k="SSN" v={d.about.ssnLast4 ? `•••-••-${d.about.ssnLast4}` : null} /><Row k="Desired move-in" v={d.about.desiredMoveIn ? formatDate(d.about.desiredMoveIn) : null} />
            </dl>
            <dl className="text-sm"><h3 className="mb-1 font-medium">Residence</h3>
              <Row k="Current address" v={d.residence.currentAddress} /><Row k="Time there" v={d.residence.monthsAtAddress ? `${d.residence.monthsAtAddress} months` : null} /><Row k="Current rent" v={d.residence.currentRent ? `$${d.residence.currentRent}` : null} /><Row k="Landlord" v={[d.residence.landlordName, d.residence.landlordPhone].filter(Boolean).join(" · ")} /><Row k="Reason for moving" v={d.residence.reasonForMoving} />
            </dl>
            <dl className="text-sm"><h3 className="mb-1 font-medium">Work &amp; income</h3>
              <Row k="Employer" v={d.employment.employer} /><Row k="Title" v={d.employment.title} /><Row k="Time employed" v={d.employment.monthsEmployed ? `${d.employment.monthsEmployed} months` : null} /><Row k="Monthly income" v={formatMoney(incomeOf(d))} />
            </dl>
            <dl className="text-sm"><h3 className="mb-1 font-medium">Other</h3>
              <Row k="Occupants" v={d.more.occupants} /><Row k="Pets" v={d.more.pets} /><Row k="Vehicles" v={d.more.vehicles} /><Row k="Reference" v={d.more.reference} /><Row k="Prior eviction" v={d.more.evicted === "yes" ? "Yes" : d.more.evicted === "no" ? "No" : null} />
            </dl>
            <dl className="text-sm sm:col-span-2"><h3 className="mb-1 font-medium">Fee &amp; consent</h3>
              <Row k="Application fee" v={a.feeCents ? `${formatMoney(a.feeCents)} · ${a.feePaidAt ? `paid ${formatDate(a.feePaidAt)}` : "unpaid"}` : "No fee"} />
              <Row k="Screening authorization" v={a.consentAt ? `${a.consentAt.toISOString().replace("T", " ").slice(0, 16)} UTC${a.consentIp ? ` from ${a.consentIp}` : ""}` : null} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
