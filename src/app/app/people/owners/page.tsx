import { Briefcase as BriefcaseIcon } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listOwners } from "@/server/rentals/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { OwnersTable } from "@/components/rentals/tables";

export const metadata = { title: "Owners" };

export default async function OwnersPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) return <Forbidden what="people" />;
  const rows = await listOwners(ctx);
  const canEdit = can(ctx.permissions, "people", "edit");
  return (
    <>
      <PageHeader icon={<BriefcaseIcon aria-hidden />}
        title="Owners"
        description="The people or companies who own the properties you manage. Click one to see what they own and what you’ve paid them."
        actions={canEdit ? <Button asChild><Link href="/app/new/owner" scroll={false}><Plus aria-hidden /> Add owner</Link></Button> : null}
      />
      <OwnersTable rows={rows} canEdit={canEdit} canDelete={can(ctx.permissions, "people", "delete")} />
    </>
  );
}
