import { describe, expect, it } from "vitest";
import { canonical, generateLicenseKeys, licenseWindow, signLicense, verifyLicense, type LicenseClaims } from "@/lib/license";

const keys = generateLicenseKeys(); // test-only fixture keys
const other = generateLicenseKeys();
const claims: LicenseClaims = { licenseId: "lic_1", customer: "ann@example.com", mode: "SELF_HOSTED", planKey: "local_annual", maxUnits: 40, features: ["accounting", "maintenance"], validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z", graceDays: 14, releaseChannel: "stable", issuedAt: "2026-01-01T00:00:00.000Z" };

describe("license signing", () => {
  it("canonical JSON sorts keys at every level", () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it("signs and verifies", () => {
    const t = signLicense(claims, keys.privateKey);
    expect(t.startsWith("DW1.")).toBe(true);
    const v = verifyLicense(t, keys.publicKey);
    expect(v).toEqual({ ok: true, claims });
  });
  it("accepts keys stored with literal \\n", () => {
    const t = signLicense(claims, keys.privateKey.replace(/\n/g, "\\n"));
    expect(verifyLicense(t, keys.publicKey.replace(/\n/g, "\\n")).ok).toBe(true);
  });
  it("rejects tampering, the wrong key, and junk", () => {
    const t = signLicense(claims, keys.privateKey);
    const [, body, sig] = t.split(".");
    const forged = Buffer.from(Buffer.from(body!, "base64url").toString().replace('"maxUnits":40', '"maxUnits":4000')).toString("base64url");
    expect(verifyLicense(`DW1.${forged}.${sig}`, keys.publicKey)).toEqual({ ok: false, reason: "signature" });
    expect(verifyLicense(t, other.publicKey)).toEqual({ ok: false, reason: "signature" });
    expect(verifyLicense("hello", keys.publicKey)).toEqual({ ok: false, reason: "format" });
    expect(verifyLicense(signLicense({ ...claims, mode: "HOSTED" as "SELF_HOSTED" }, keys.privateKey), keys.publicKey)).toEqual({ ok: false, reason: "claims" });
  });
  it("valid → grace → expired", () => {
    expect(licenseWindow(claims, new Date("2026-06-01")).state).toBe("valid");
    const g = licenseWindow(claims, new Date("2027-01-05"));
    expect(g.state).toBe("grace");
    expect(g.graceEnds.toISOString()).toBe("2027-01-14T00:00:00.000Z");
    expect(licenseWindow(claims, new Date("2027-01-15")).state).toBe("expired");
    expect(licenseWindow(claims, new Date("2025-12-01")).state).toBe("not_yet");
  });
});
