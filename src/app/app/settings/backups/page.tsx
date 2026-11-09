import { ShieldCheck } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { BackupPanel } from "@/components/admin/backup-panel";
import { backupRuns } from "@/server/ops/backup-list";
import { mayManageBackups } from "@/server/ops/backup-access";

export const metadata = { title: "Backups" };

export default async function BackupsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "view")) return <Forbidden what="backups" />;
  const manage = await mayManageBackups();
  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader eyebrow="Settings" title="Backups" description="A copy of everything — properties, tenants, money, files list and settings — is saved automatically every night. The newest 14 are kept." />
      {manage ? (
        <>
          <BackupPanel runs={await backupRuns()} />
          <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted-foreground">Keep a downloaded copy somewhere safe (a USB stick or cloud drive) now and then. To put a backup back, see “Restore a backup” in docs/LAUNCH.md — it replaces everything, so it&apos;s done on purpose, not with a button.</p>
        </>
      ) : (
        <p className="flex items-start gap-2 rounded-card border border-border bg-surface p-4 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />DeedWood backs up your company&apos;s data every night on our servers. If you ever need something restored, contact DeedWood support.</p>
      )}
    </div>
  );
}
