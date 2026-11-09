import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateLicenseKeys, signLicense, type LicenseClaims } from "@/lib/license";
import { installLicense, licenseCheckIn, localLicense, TRIAL_DAYS } from "@/server/license/local";

const keys = generateLicenseKeys();
const dirs: string[] = [];
const env = (extra: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), "dw-lic-"));
  dirs.push(d);
  return { DEEDWOOD_DEPLOYMENT: "LOCAL", DEEDWOOD_DATA_DIR: d, LICENSE_PUBLIC_KEY: keys.publicKey, ...extra } as Record<string, string>;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const claims = (o: Partial<LicenseClaims> = {}): LicenseClaims => ({ licenseId: "lic_1", customer: "ann@example.com", mode: "SELF_HOSTED", planKey: "local_annual", maxUnits: 20, features: ["accounting"], validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-12-31T00:00:00.000Z", graceDays: 14, releaseChannel: "stable", issuedAt: "2026-01-01T00:00:00.000Z", ...o });

describe("computer-install licenses", () => {
  it("hosted servers and copies without a license key aren't limited", () => {
    expect(localLicense(new Date(), { DEEDWOOD_DEPLOYMENT: "" }).state).toBe("hosted");
    const e = env();
    delete e.LICENSE_PUBLIC_KEY;
    expect(localLicense(new Date(), e)).toMatchObject({ state: "not_enforced", readOnly: false });
  });
  it("no license: 30-day trial from first start, then read-only", () => {
    const e = env();
    const start = new Date("2026-03-01T00:00:00Z");
    expect(localLicense(start, e)).toMatchObject({ state: "trial", readOnly: false, daysLeft: TRIAL_DAYS });
    expect(localLicense(new Date("2026-03-20T00:00:00Z"), e).daysLeft).toBe(11);
    expect(localLicense(new Date("2026-04-01T00:00:00Z"), e)).toMatchObject({ state: "trial_over", readOnly: true });
  });
  it("valid → grace → read-only; unit limit comes from the license", () => {
    const e = env();
    installLicense(signLicense(claims(), keys.privateKey), e);
    expect(localLicense(new Date("2026-06-01"), e)).toMatchObject({ state: "valid", readOnly: false, maxUnits: 20 });
    expect(localLicense(new Date("2027-01-05"), e)).toMatchObject({ state: "grace", readOnly: false });
    expect(localLicense(new Date("2027-02-01"), e)).toMatchObject({ state: "expired", readOnly: true });
  });
  it("refuses a forged license and treats a bad file as read-only", () => {
    const e = env();
    const other = generateLicenseKeys();
    expect(() => installLicense(signLicense(claims(), other.privateKey), e)).toThrow(/isn't a valid DeedWood license/);
    writeFileSync(join(e.DEEDWOOD_DATA_DIR!, "DeedWood.license"), "DW1.junk.junk");
    expect(localLicense(new Date("2026-06-01"), e)).toMatchObject({ state: "invalid", readOnly: true });
  });
  it("daily check-in: picks up a renewal, a revocation, and update notices; offline changes nothing", async () => {
    const e = env({ LICENSE_CHECKIN_URL: "https://control.example/api/license/checkin" });
    installLicense(signLicense(claims(), keys.privateKey), e);
    const renewed = signLicense(claims({ validUntil: "2027-12-31T00:00:00.000Z" }), keys.privateKey);
    const reply = (body: object) => (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await licenseCheckIn("1.0.0", 12, e, reply({ status: "active", token: renewed, latestVersion: "1.2.0", minVersion: "1.1.0", updateRequired: true }));
    expect(localLicense(new Date("2027-06-01"), e)).toMatchObject({ state: "valid", updateRequired: true, latestVersion: "1.2.0" });
    await licenseCheckIn("1.2.0", 12, e, reply({ status: "revoked", latestVersion: null, minVersion: null, updateRequired: false, message: "Refunded" }));
    expect(localLicense(new Date("2027-06-01"), e)).toMatchObject({ state: "revoked", readOnly: true, message: "Refunded" });
    const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await licenseCheckIn("1.2.0", 12, e, offline)).toBeNull();
    expect(localLicense(new Date("2027-06-01"), e).state).toBe("revoked");
  });
});
