import type { AppContext } from "@/server/context";
import { StatusBadge } from "@/components/patterns/status-badge";
import { SendForSignature, VoidSignatureButton } from "./esign-buttons";
import { ensureDefaultTemplates } from "@/server/funnel/esign";
import { formatDate } from "@/lib/dates";

/** Lease e-signatures: send from a template, track each signer, download the signed copy. */
export async function ESignPanel({ ctx, leaseId, canEdit }: { ctx: AppContext; leaseId: string; canEdit: boolean }) {
  if (canEdit) await ensureDefaultTemplates(ctx.db);
  const [requests, templates] = await Promise.all([
    ctx.db.signatureRequest.findMany({ where: { leaseId }, orderBy: { createdAt: "desc" }, include: { signers: { orderBy: { order: "asc" } } } }),
    ctx.db.documentTemplate.findMany({ where: { deletedAt: null, kind: { in: ["LEASE", "NOTICE", "OTHER"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <section aria-labelledby="esign-h" className="mb-4 rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="esign-h" className="mr-auto font-semibold">E-signatures</h2>
        {canEdit ? <SendForSignature leaseId={leaseId} templates={templates} /> : null}
      </div>
      {requests.length ? (
        <ul className="divide-y divide-border text-sm">
          {requests.map((r) => (
            <li key={r.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.title}</span><StatusBadge status={r.status} />
                <span className="text-xs text-muted-foreground">sent {formatDate(r.createdAt)}{r.completedAt ? ` · completed ${formatDate(r.completedAt)}` : ""}</span>
                <span className="ml-auto flex gap-2">
                  {r.finalAttachmentId ? <a className="text-primary hover:underline" href={`/api/files/${r.finalAttachmentId}`} target="_blank" rel="noreferrer">Signed copy</a> : null}
                  {canEdit && r.status === "SENT" ? <VoidSignatureButton id={r.id} /> : null}
                </span>
              </div>
              <ul className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                {r.signers.map((s) => <li key={s.id}>{s.name} ({s.role.toLowerCase()}): <span className={s.status === "SIGNED" ? "text-success" : ""}>{s.status === "SIGNED" ? `signed ${s.signedAt ? formatDate(s.signedAt) : ""}` : s.status.toLowerCase()}</span></li>)}
              </ul>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nothing sent yet. Send the lease from a template — tenants sign first, then you countersign. The signed copy and an audit certificate are saved here.</p>}
    </section>
  );
}
