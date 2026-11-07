import { headers } from "next/headers";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { adminDb } from "@/server/db";
import { recordView } from "@/server/funnel/esign";
import { accessibleBrand } from "@/server/portal/queries";
import { PublicShell } from "@/components/funnel/public-shell";
import { SignForm } from "@/components/funnel/sign-form";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign", robots: { index: false } };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const r = await recordView(token, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, ua: h.get("user-agent") });
  if (!r) {
    return <main className="portal-density mx-auto max-w-md p-10 text-center"><h1 className="text-xl font-semibold">This signing link isn&apos;t valid</h1><p className="mt-2 text-muted-foreground">It may have been replaced by a newer email. Check your inbox for the latest link, or contact the sender.</p></main>;
  }
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: r.signer.organizationId } });
  const signer = await r.db.signer.findFirstOrThrow({ where: { id: r.signer.id } });
  const req = await r.db.signatureRequest.findFirstOrThrow({ where: { id: r.request.id }, include: { signers: { orderBy: { order: "asc" } } } });
  const waiting = req.signers.filter((s) => s.order < signer.order && s.status !== "SIGNED");
  return (
    <PublicShell org={org} brand={accessibleBrand(org.brandColor)}>
      <div className="mx-auto grid max-w-3xl gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{req.title}</h1>
          <p className="text-sm text-muted-foreground">From {org.name} to {signer.name} · sent {formatDate(req.createdAt)}</p>
        </div>
        <article className="rounded-card border border-border bg-surface p-6 font-serif leading-relaxed shadow-card [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3" dangerouslySetInnerHTML={{ __html: req.documentHtml }} />
        <section aria-label="Signers" className="rounded-card border border-border bg-surface p-4 text-sm shadow-card">
          <ul className="grid gap-1">{req.signers.map((s) => <li key={s.id} className="flex items-center gap-2">{s.status === "SIGNED" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span aria-hidden className="size-4 rounded-full border border-border-strong" />}{s.name} ({s.role.toLowerCase()}) — {s.status === "SIGNED" ? `signed ${s.signedAt ? formatDate(s.signedAt) : ""}` : "not signed yet"}</li>)}</ul>
        </section>
        <section aria-label="Sign" className="rounded-card border border-border bg-surface p-5 shadow-card">
          {req.status === "COMPLETED" ? <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-5" aria-hidden /> Everyone has signed. A signed copy is stored with your lease.</p>
            : req.status !== "SENT" ? <p className="text-muted-foreground">This document was {req.status.toLowerCase()}.</p>
            : signer.status === "SIGNED" ? <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="size-5" aria-hidden /> You signed on {signer.signedAt ? formatDate(signer.signedAt) : ""}. We&apos;ll email everyone when all signatures are in.</p>
            : waiting.length ? <p className="text-muted-foreground">Waiting for {waiting.map((w) => w.name).join(", ")} to sign first.</p>
            : <SignForm token={token} name={signer.name} />}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden /> Document fingerprint (SHA-256) {req.documentHash.slice(0, 16)}… · your IP and device are recorded with your signature.</p>
        </section>
      </div>
    </PublicShell>
  );
}
