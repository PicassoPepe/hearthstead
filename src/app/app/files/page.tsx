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
        <EmptyState icon={<FileText />} title="Document templates arrive in Phase 9" description="Lease and notice templates with merge fields like {{tenant.name}} and {{lease.rent}}." />
      ) : (
        <EmptyState icon={<FileSignature />} title="E-signatures arrive in Phase 9" description="Track who has signed what, with a full audit trail." />
      )}
    </>
  );
}
