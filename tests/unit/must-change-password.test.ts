import { describe, expect, it } from "vitest";
import { mustChangePasswordBlocks } from "@/lib/must-change-password";

describe("temporary password gate", () => {
  it("blocks the app until the password is changed, except while the owner is viewing as them", () => {
    expect(mustChangePasswordBlocks({ mustChangePassword: true }, false)).toBe(true);
    expect(mustChangePasswordBlocks({ mustChangePassword: true }, true)).toBe(false);
    expect(mustChangePasswordBlocks({ mustChangePassword: false }, false)).toBe(false);
  });
});
