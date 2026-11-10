import { adminDb } from "@/server/db";
import { UserFacingError } from "@/server/action-result";
import { hashPassword, PASSWORD_MIN, verifyPassword } from "./password";

/** Replace an owner-issued temporary password. Throws UserFacingError when it isn't allowed. */
export async function applyRequiredPasswordChange(userId: string, current: string, next: string) {
  const user = await adminDb.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw new UserFacingError("Sign in first");
  if (!user.mustChangePassword) return user;
  if (!(await verifyPassword(current, user.passwordHash))) throw new UserFacingError("That isn't the current password", { current: "Doesn't match" });
  if (next.length < PASSWORD_MIN) throw new UserFacingError(`Use at least ${PASSWORD_MIN} characters`, { next: "Too short" });
  if (next === current) throw new UserFacingError("Choose a different password than the temporary one", { next: "Must be new" });
  return adminDb.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
}
