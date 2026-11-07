import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, totp, verifyTotp } from "@/server/platform/totp";

describe("TOTP", () => {
  it("matches RFC 6238 test vectors (SHA-1)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1_111_111_109_000)).toBe("081804");
    expect(totp(secret, 2_000_000_000_000)).toBe("279037");
  });
  it("round-trips base32 and tolerates one step of drift", () => {
    expect(base32Decode(base32Encode(Buffer.from("hello world"))).toString()).toBe("hello world");
    const s = base32Encode(Buffer.from("abcdefghijabcdefghij"));
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, "12345", now)).toBe(false);
  });
});
