import { Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listTenants } from "@/server/leasing/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { TenantsTable } from "@/components/leasing/tenants-table";

export const metadata = { title: "Tenants" };

export default async function TenantsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "people", "view")) return <Forbidden what="people" />;
  const rows = await listTenants(ctx);
  const canEdit = can(ctx.permissions, "people", "edit");
  return (
    <>
      <PageHeader icon={<UsersIcon aria-hidden />} title="Tenants" description="Everyone on a lease, with their unit and balance." actions={canEdit ? <Button asChild><Link href="/app/new/tenant" scroll={false}><Plus aria-hidden /> Add tenant</Link></Button> : null} />
      <TenantsTable rows={rows} canEdit={canEdit} />
    </>
  );
}
