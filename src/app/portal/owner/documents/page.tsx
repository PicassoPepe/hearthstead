import { FileText } from "lucide-react";
import { requireOwnerPortal } from "@/server/portal/owner-context";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Documents" };

export default async function OwnerDocuments() {
  const o = await requireOwnerPortal();
  const files = await o.db.attachment.findMany({ where: { OR: [{ entityType: "Owner", entityId: o.owner.id }, { entityType: "Property", entityId: { in: o.propertyIds } }] }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
      <Card className="divide-y divide-border">
        {files.map((f) => (
          <a key={f.id} href={`/api/owner/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-muted/60">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1"><span className="font-medium">{f.name}</span><span className="block text-xs text-muted-foreground">{f.entityType === "Property" ? o.properties.find((p) => p.id === f.entityId)?.name : "Your documents"} · {formatDate(f.createdAt)}</span></span>
          </a>
        ))}
        {!files.length ? <p className="p-6 text-center text-sm text-muted-foreground">No documents shared yet. Management agreements, insurance and statements will appear here.</p> : null}
      </Card>
    </div>
  );
}
