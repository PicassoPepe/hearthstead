import { Globe } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { adminDb } from "@/server/db";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { WebsiteEditor } from "@/components/site/website-editor";
import { getWebsite } from "@/server/site/service";
import { siteSchema } from "@/lib/site/blocks";

export const metadata = { title: "Your website" };

export default async function WebsitePage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "edit")) return <Forbidden what="the website editor" />;
  const w = await getWebsite(ctx.db);
  const versions = await ctx.db.websiteVersion.findMany({ orderBy: { publishedAt: "desc" }, take: 30 });
  const people = new Map((await adminDb.user.findMany({ where: { id: { in: versions.map((v) => v.publishedById ?? "") } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  const root = process.env.SITES_ROOT_DOMAIN;
  return (
    <>
      <PageHeader icon={<Globe aria-hidden />} title="Your website" description="A public website for your company: available homes, announcements, tours, contact and resident logins. Switch any section on or off, then press Publish." />
      <WebsiteEditor
        initial={siteSchema.parse(w.draft)}
        orgSlug={ctx.org.slug}
        publishedAt={w.publishedAt?.toISOString() ?? null}
        live={w.live}
        customDomain={w.customDomain}
        subdomainUrl={root ? `https://${ctx.org.slug}.${root}` : null}
        versions={versions.map((v) => ({ id: v.id, at: v.publishedAt.toISOString(), note: v.note, by: people.get(v.publishedById ?? "") ?? "—" }))}
        changedSincePublish={!w.published || JSON.stringify(w.published) !== JSON.stringify(w.draft)}
      />
    </>
  );
}
