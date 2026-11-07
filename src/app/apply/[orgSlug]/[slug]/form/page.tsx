import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { publishedListings } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";
import { ApplyForm } from "@/components/funnel/apply-form";
import { applicationByToken, applicationDataSchema } from "@/server/funnel/applications";
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
  return (
    <PublicShell org={d.org} brand={d.brand}>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Application #{a.number} · {l.title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">Signed in as {a.email}</p>
        <ApplyForm orgSlug={orgSlug} slug={slug} initial={applicationDataSchema.parse(a.data)} initialStep={a.step} fee={a.feeCents ? formatMoney(a.feeCents) : null} feePaid={Boolean(a.feePaidAt)} />
      </div>
    </PublicShell>
  );
}
