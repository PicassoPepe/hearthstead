import { paymentsEnabled } from "@/lib/payments-flag";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { Forbidden } from "@/components/patterns/forbidden";
import { SetupWizard } from "@/components/onboarding/setup-wizard";

export const metadata = { title: "Set up your company" };

/** First-run setup: company & logo → first property (or sample data) → payments → team. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "edit")) return <Forbidden what="company setup" />;
  const sp = await searchParams;
  const [org, propertyCount, processor, roles, members] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
    ctx.db.property.count(),
    ctx.db.processorAccount.findFirst(),
    ctx.db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, key: true } }),
    ctx.db.membership.count({ where: { deletedAt: null } }),
  ]);
  return (
    <SetupWizard
      initialStep={Math.min(4, Math.max(1, Number(sp.step) || 1))}
      firstName={ctx.user.name?.split(" ")[0] ?? null}
      org={{ name: org.name, email: org.email ?? "", phone: org.phone ?? "", addressLine1: org.addressLine1 ?? "", city: org.city ?? "", state: org.state ?? "", postalCode: org.postalCode ?? "", timezone: org.timezone, brandColor: org.brandColor, logoUrl: org.logoUrl, isSandbox: org.isSandbox }}
      propertyCount={propertyCount}
      paymentsConnected={Boolean(processor)}
      paymentsOn={paymentsEnabled()}
      roles={roles.filter((r) => r.key !== "OWNER_PORTAL")}
      memberCount={members}
    />
  );
}
