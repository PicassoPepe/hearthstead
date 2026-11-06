import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { CompanyForm } from "@/components/settings/company-form";

export const metadata = { title: "Company & branding" };

export default async function CompanySettingsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Company & branding" eyebrow="Settings" description="Your company profile and portal branding." />
      <CompanyForm
        canEdit={can(ctx.permissions, "settings", "edit")}
        defaults={{
          name: org.name,
          email: org.email ?? "",
          phone: org.phone ?? "",
          addressLine1: org.addressLine1 ?? "",
          city: org.city ?? "",
          state: org.state ?? "",
          postalCode: org.postalCode ?? "",
          timezone: org.timezone,
          brandColor: org.brandColor,
        }}
      />
    </div>
  );
}
