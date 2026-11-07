import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { publicOrg } from "@/server/public/listings";
import { PublicShell } from "@/components/funnel/public-shell";

export const metadata = { title: "Application submitted" };

export default async function ApplyDone({ params }: { params: Promise<{ orgSlug: string }> }) {
  const o = await publicOrg((await params).orgSlug);
  if (!o) notFound();
  return (
    <PublicShell org={o.org} brand={o.brand}>
      <div className="mx-auto max-w-md rounded-card border border-border bg-surface p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <h1 className="mt-3 text-2xl font-semibold">Application submitted</h1>
        <p className="mt-2 text-muted-foreground">Thanks! {o.org.name} will review it and email you — usually within 2 business days.</p>
      </div>
    </PublicShell>
  );
}
