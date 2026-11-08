import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { CompanyForm } from "@/components/settings/company-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogoPicker } from "@/components/images/branding-images";

export const metadata = { title: "Company & branding" };

export default async function CompanySettingsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="company settings" />;
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Company & branding" eyebrow="Settings" description="Your company profile and portal branding." />
      <Card className="mb-4">
        <CardHeader><div><CardTitle>Logo</CardTitle><CardDescription>Your logo appears across the app, the resident and owner portals and your listings site.</CardDescription></div></CardHeader>
        <CardContent><LogoPicker current={org.logoUrl} disabled={!can(ctx.permissions, "settings", "edit")} /></CardContent>
      </Card>
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
