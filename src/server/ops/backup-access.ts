import "server-only";
import { auth } from "@/server/auth";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { isPlatformAdmin } from "@/server/platform-admin/service";
import { isLocalInstall } from "@/server/license/local";

/**
 * A backup holds every company on the server, so: the platform owner always; on a computer
 * install (one customer) also staff who can edit Settings.
 */
export async function mayManageBackups(): Promise<boolean> {
  const s = await auth();
  if (s?.user?.id && (await isPlatformAdmin(s.user.id))) return true;
  if (!isLocalInstall()) return false;
  const ctx = await getContext();
  return Boolean(ctx && can(ctx.permissions, "settings", "edit"));
}
