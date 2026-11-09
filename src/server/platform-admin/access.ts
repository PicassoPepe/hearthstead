import "server-only";
import { headers } from "next/headers";
import { adminDb } from "@/server/db";
import { auth } from "@/server/auth";
import { clientIp } from "@/server/auth/rate-limit";
import { ipAllowed, PlatformAccessError, type PlatformCtx } from "./service";

/** Who is asking, if they may use /admin. `allowNoMfa` is only for the two-factor setup page. */
export async function getPlatformCtx(opts: { allowNoMfa?: boolean } = {}): Promise<PlatformCtx> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new PlatformAccessError("signed_out");
  const h = await headers();
  const ip = clientIp(h);
  if (!ipAllowed(ip)) throw new PlatformAccessError("ip_blocked");
  const [admin, user] = await Promise.all([adminDb.platformAdmin.findUnique({ where: { userId } }), adminDb.user.findUnique({ where: { id: userId } })]);
  if (!admin || !user || user.deletedAt) throw new PlatformAccessError("not_admin");
  if (!user.twoFactorEnabled && !opts.allowNoMfa) throw new PlatformAccessError("mfa_required");
  return { userId, email: user.email, name: user.name, role: admin.role, ip, userAgent: h.get("user-agent") };
}

