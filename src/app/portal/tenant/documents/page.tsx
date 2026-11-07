import { FileText } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Documents" };

/** Lease documents shared with the tenant (files attached to their lease). */
export default async function DocumentsPage() {
  const ctx = await requirePortal();
  const files = ctx.lease ? await ctx.db.attachment.findMany({ where: { entityType: "Lease", entityId: ctx.lease.id }, orderBy: { createdAt: "desc" } }) : [];
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
      {files.length ? (
        <Card className="divide-y divide-border">
          {files.map((f) => (
            <a key={f.id} href={`/api/portal/files/${f.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
              <FileText className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground">{formatDate(f.createdAt)}</span>
            </a>
          ))}
        </Card>
      ) : (
        <Card className="p-6 text-center text-muted-foreground">Your signed lease and notices will appear here.</Card>
      )}
    </div>
  );
}
