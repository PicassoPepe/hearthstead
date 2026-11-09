import { cookies } from "next/headers";
import { paymentsEnabled } from "@/lib/payments-flag";
import { notFound, redirect } from "next/navigation";
import { publishedListings } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";
import { ApplyForm } from "@/components/funnel/apply-form";
import { applicationByToken, applicationDataSchema, household, ROLE_LABEL } from "@/server/funnel/applications";
import { HouseholdPanel } from "@/components/funnel/household-panel";
import { APPLY_COOKIE } from "@/lib/funnel";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Application" };

export default async function ApplyFormPage({ params }: { params: Promise<{ orgSlug: string; slug: string }> }) {
  const { orgSlug, slug } = await params;
  const d = await publishedListings(orgSlug);
  const l = d?.listings.find((x) => x.slug === slug);
  if (!d || !l) notFound();
  const a = await applicationByToken(d.db, (await cookies()).get(APPLY_COOKIE)?.value);
  if (!a || a.listingId !== l.id) redirect(`/apply/${orgSlug}/${slug}`);
  if (a.status !== "DRAFT") redirect(`/apply/${orgSlug}/${slug}/done`);
  const hh = await household(d.db, a.id);
  const primary = hh?.members.find((m) => m.role === "PRIMARY");
  return (
    <PublicShell org={d.org} brand={d.brand}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Application #{a.number} · {l.title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">Signed in as {a.email}</p>
        {a.role !== "PRIMARY" ? (
          <p role="status" className="mb-6 rounded-card border border-primary/30 bg-primary-soft/40 p-4 text-sm">
            You&apos;re applying as a <strong>{ROLE_LABEL[a.role]?.toLowerCase()}</strong>{primary ? <> with <strong>{primary.name}</strong></> : null}. {a.role === "GUARANTOR" ? "As a guarantor you agree to cover the rent if the tenants don't — we'll check your income and credit." : "Fill in your own details; they're kept separate from the other applicants'."}
          </p>
        ) : null}
        {a.feeCents && !paymentsEnabled() ? <p className="mb-4 rounded-lg bg-surface-muted p-3 text-sm">There&apos;s a {formatMoney(a.feeCents)} application fee. Online payment is coming soon — the property manager will tell you how to pay it.</p> : null}
        <ApplyForm orgSlug={orgSlug} slug={slug} initial={applicationDataSchema.parse(a.data)} initialStep={a.step} fee={a.feeCents && paymentsEnabled() ? formatMoney(a.feeCents) : null} feePaid={Boolean(a.feePaidAt)} />
        {a.role === "PRIMARY" && hh ? <HouseholdPanel orgSlug={orgSlug} slug={slug} members={hh.members.filter((m) => m.role !== "PRIMARY").map((m) => ({ id: m.id, role: m.role, name: m.name, email: m.email, status: m.status }))} /> : null}
      </div>
    </PublicShell>
  );
}
