"use server";

import { revalidatePath } from "next/cache";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { adminDb } from "@/server/db";
import { runBackup } from "@/server/ops/backup-job";
import { mayManageBackups } from "@/server/ops/backup-access";

/** "Back up now" (owner console, or Settings → Backups on a computer install). */
export async function backupNowAction(): Promise<ActionResult<{ kb: number }>> {
  return runAction(async () => {
    if (!(await mayManageBackups())) throw new UserFacingError("You don't have access to backups.");
    const r = await runBackup(adminDb);
    if (!r.ok) throw new UserFacingError(`The backup didn't work: ${r.error}`);
    revalidatePath("/admin/health");
    revalidatePath("/app/settings/backups");
    return { kb: Math.round(r.bytes / 1024) };
  }, "Backup saved");
}
