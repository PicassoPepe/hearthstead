import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { FeeRulesEditor } from "@/components/books/owner-views";

export const metadata = { title: "Management fee settings" };

export default async function ManagementFeeSettings() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  const [rules, props] = await Promise.all([ctx.db.managementFeeRule.findMany({ orderBy: { createdAt: "asc" } }), ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Settings" title="Management fees" description="Each month, every property is billed its fee by your management company and the bill is paid from the property's operating account." />
      <FeeRulesEditor rules={rules} properties={props} canEdit={can(ctx.permissions, "settings", "edit")} />
    </div>
  );
}
