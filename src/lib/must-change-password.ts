/** True when the staff app should show only the change-password screen. */
export function mustChangePasswordBlocks(user: { mustChangePassword: boolean }, impersonating: boolean): boolean {
  return user.mustChangePassword && !impersonating;
}
