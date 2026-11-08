import { DoorOpen as DoorOpenIcon } from "lucide-react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { listUnits } from "@/server/rentals/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Button } from "@/components/ui/button";
import { UnitsTable } from "@/components/rentals/tables";

export const metadata = { title: "Units" };

export default async function UnitsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "rentals", "view")) return <Forbidden what="rentals" />;
  const rows = await listUnits(ctx);
  const canEdit = can(ctx.permissions, "rentals", "edit");
  return (
    <>
      <PageHeader icon={<DoorOpenIcon aria-hidden />}
        title="Units"
        description="Every rentable unit across your properties."
        actions={canEdit ? <Button asChild><Link href="/app/new/unit" scroll={false}><Plus aria-hidden /> Add unit</Link></Button> : null}
      />
      <UnitsTable rows={rows} canEdit={canEdit} canDelete={can(ctx.permissions, "rentals", "delete")} />
    </>
  );
}
