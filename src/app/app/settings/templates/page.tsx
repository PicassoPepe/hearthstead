import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { TemplateEditor } from "@/components/funnel/template-editor";
import { ensureDefaultTemplates } from "@/server/funnel/esign";

export const metadata = { title: "Document templates" };

export default async function TemplatesPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  if (can(ctx.permissions, "settings", "edit")) await ensureDefaultTemplates(ctx.db);
  const templates = await ctx.db.documentTemplate.findMany({ where: { deletedAt: null }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, body: true } });
  return (
    <>
      <PageHeader eyebrow="Settings" title="Document templates" description="Leases, renewals, notices and adverse action letters with merge fields. Used for e-signature and applicant notices." />
      <TemplateEditor templates={templates} canEdit={can(ctx.permissions, "settings", "edit")} />
    </>
  );
}
