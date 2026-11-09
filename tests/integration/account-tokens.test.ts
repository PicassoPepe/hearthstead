import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueToken, peekToken, resetPassword, verifyEmail } from "@/server/auth/account-tokens";
import { verifyPassword } from "@/server/auth/password";
import { admin, app } from "./helpers";

let userId: string;
const email = `reset-${Date.now()}@example.org`;

beforeAll(async () => {
  userId = (await admin.user.create({ data: { email } })).id;
  await admin.userSession.create({ data: { userId } });
});
afterAll(async () => {
  await admin.accountToken.deleteMany({ where: { userId } });
  await admin.userSession.deleteMany({ where: { userId } });
  await admin.user.delete({ where: { id: userId } });
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("forgot password", () => {
  it("one-time, newest-only, expiring links; resets sign everyone out", async () => {
    const old = await issueToken(userId, "RESET_PASSWORD");
    const t = await issueToken(userId, "RESET_PASSWORD");
    expect(await peekToken(old, "RESET_PASSWORD")).toBeNull(); // replaced by the newer link
    expect(await peekToken(t, "VERIFY_EMAIL")).toBeNull(); // wrong kind
    // Only a hash is stored.
    expect(await admin.accountToken.count({ where: { tokenHash: t } })).toBe(0);
    await expect(resetPassword(t, "short")).rejects.toThrow(/at least 10/);
    await expect(resetPassword(t, "a-brand-new-password", new Date(Date.now() + 31 * 60_000))).rejects.toThrow(/expired/);
    const u = await resetPassword(t, "a-brand-new-password");
    expect(await verifyPassword("a-brand-new-password", u.passwordHash)).toBe(true);
    expect(u.emailVerified).not.toBeNull();
    expect(await admin.userSession.count({ where: { userId, revokedAt: null } })).toBe(0);
    await expect(resetPassword(t, "another-password-here")).rejects.toThrow(/already used/);
  });
});

describe("email confirmation", () => {
  it("confirms once", async () => {
    await admin.user.update({ where: { id: userId }, data: { emailVerified: null } });
    const t = await issueToken(userId, "VERIFY_EMAIL");
    await verifyEmail(t);
    expect((await admin.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).not.toBeNull();
    await expect(verifyEmail(t)).rejects.toThrow(/expired or was already used/);
  });
});
