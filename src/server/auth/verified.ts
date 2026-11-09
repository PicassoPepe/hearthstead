import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";

/** Risky actions (API keys, connecting payouts) need a confirmed email. */
export async function requireVerifiedEmail(userId: string) {
  const u = await adminDb.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  if (!u?.emailVerified) throw new UserFacingError("Confirm your email first — use “Send it again” on the yellow note at the top of the page.");
}
