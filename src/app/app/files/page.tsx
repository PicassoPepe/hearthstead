import { FolderOpen as FolderOpenIcon } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { filesFor } from "@/server/records/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { FilesPanel } from "@/components/records/files-panel";
import { Importer } from "@/components/files/importer";
import { FileSignature, FileText } from "lucide-react";
import type { ImportKind } from "@/lib/importer";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Files" };

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ tab?: string; import?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "files", "view")) return <Forbidden what="files" />;
  const tab = sp.import ? "import" : (sp.tab ?? "library");
  const canImport = {
    properties: can(ctx.permissions, "rentals", "edit") && ctx.membership.propertyScope.length === 0,
    owners: can(ctx.permissions, "people", "edit"),
    leases: can(ctx.permissions, "leasing", "edit") && ctx.membership.propertyScope.length === 0,
  };
  return (
    <>
      <PageHeader icon={<FolderOpenIcon aria-hidden />} title="Files" description="Every document across your properties, plus spreadsheet imports and templates." />
      <EntityTabs
        base="/app/files"
        active={tab}
        tabs={[
          { id: "library", label: "Library" },
          { id: "import", label: "Import" },
          { id: "templates", label: "Templates" },
          { id: "signatures", label: "Signatures" },
        ]}
      />
      {tab === "library" ? (
        <FilesPanel files={await filesFor(ctx)} canEdit={can(ctx.permissions, "files", "edit")} />
      ) : tab === "import" ? (
        canImport.properties || canImport.owners || canImport.leases ? (
          <Importer initialKind={(sp.import === "owners" || sp.import === "leases" ? sp.import : canImport.properties ? "properties" : "owners") as ImportKind} canImport={canImport} />
        ) : (
          <Forbidden what="importing data" />
        )
      ) : tab === "templates" ? (
        <TemplatesTab ctx={ctx} />
      ) : (
        <SignaturesTab ctx={ctx} />
      )}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireContext>>;

async function TemplatesTab({ ctx }: { ctx: Ctx }) {
  const rows = await ctx.db.documentTemplate.findMany({ where: { deletedAt: null }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  if (!rows.length) return <EmptyState icon={<FileText />} title="No templates yet" description="Lease and notice templates with merge fields like {{tenant.name}} and {{lease.rent}}." action={<Button asChild><Link href="/app/settings/templates">Create a template</Link></Button>} />;
  return (
    <div className="rounded-card border border-border bg-surface shadow-card">
      <ul className="divide-y divide-border">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1 font-medium">{t.name}</span>
            <Badge>{t.kind.replace("_", " ").toLowerCase()}</Badge>
            {t.isDefault ? <Badge tone="primary">Default</Badge> : null}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-3 text-sm"><Link href="/app/settings/templates" className="font-medium text-primary hover:underline">Edit templates in Settings →</Link></p>
    </div>
  );
}

async function SignaturesTab({ ctx }: { ctx: Ctx }) {
  const rows = await ctx.db.signatureRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { signers: { select: { name: true, status: true } } } });
  if (!rows.length) return <EmptyState icon={<FileSignature />} title="Nothing sent for signature yet" description="Send a lease or renewal for e-signature from the lease's Files tab. Every view and signature is recorded with a tamper-evident hash." />;
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Signature requests</caption>
        <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Document", "Signers", "Sent", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium">{r.leaseId ? <Link href={`/app/leasing/${r.leaseId}?tab=files`} className="hover:underline">{r.title}</Link> : r.title}</td>
              <td className="px-3 py-2">{r.signers.map((s) => `${s.name}${s.status === "SIGNED" ? " ✓" : ""}`).join(", ")}</td>
              <td className="px-3 py-2 tabular">{formatDate(r.createdAt)}</td>
              <td className="px-3 py-2"><Badge tone={r.status === "COMPLETED" ? "success" : r.status === "SENT" ? "info" : "neutral"}>{r.status === "SENT" ? `Waiting · ${r.signers.filter((s) => s.status === "SIGNED").length}/${r.signers.length} signed` : r.status.toLowerCase()}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
