import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { licenseWindow, verifyLicense, type LicenseClaims } from "@/lib/license";
import { licensePublicKey } from "@/lib/license-public-key";

/**
 * Licenses on a customer's own computer (the one-click "Start DeedWood" install sets
 * DEEDWOOD_DEPLOYMENT=LOCAL). Works offline: the license file is checked with DeedWood's public
 * key. A daily check-in (when online) picks up renewals, revocations and update notices.
 *
 * - No license yet → a 30-day trial from the first start, then read-only.
 * - Past the end date → keeps working for the grace days, then read-only.
 * - Revoked by DeedWood → read-only.
 * Read-only means: you can sign in, look at everything and export, but not change anything.
 * Nothing is ever deleted.
 */
export const TRIAL_DAYS = 30;
export type LocalState = "hosted" | "not_enforced" | "trial" | "trial_over" | "valid" | "grace" | "expired" | "invalid" | "revoked";
export type LocalLicense = { state: LocalState; readOnly: boolean; maxUnits: number | null; features: string[] | null; claims?: LicenseClaims; daysLeft?: number; message: string; updateRequired?: boolean; latestVersion?: string | null };

type Env = Record<string, string | undefined>;
const dir = (env: Env) => env.DEEDWOOD_DATA_DIR ?? ".deedwood";
export const isLocalInstall = (env: Env = process.env) => env.DEEDWOOD_DEPLOYMENT === "LOCAL";
export const licensePath = (env: Env = process.env) => join(dir(env), "DeedWood.license");
const statePath = (env: Env) => join(dir(env), "license-state.json");
const firstRunPath = (env: Env) => join(dir(env), "first-run");

export type CheckInState = { lastCheckInAt?: string; revoked?: boolean; message?: string; latestVersion?: string | null; minVersion?: string | null; updateRequired?: boolean };
export function readCheckInState(env: Env = process.env): CheckInState {
  try { return JSON.parse(readFileSync(statePath(env), "utf8")) as CheckInState; } catch { return {}; }
}

function firstRun(env: Env, now: Date) {
  try { return new Date(readFileSync(firstRunPath(env), "utf8").trim()); } catch {
    try { mkdirSync(dir(env), { recursive: true }); writeFileSync(firstRunPath(env), now.toISOString()); } catch { /* read-only disk */ }
    return now;
  }
}

function readLicenseText(env: Env): string | null {
  for (const p of [licensePath(env), "DeedWood.license"]) if (existsSync(p)) return readFileSync(p, "utf8").trim();
  return null;
}

let cache: { at: number; value: LocalLicense } | null = null;
export function resetLocalLicenseCache() { cache = null; }

export function localLicense(now = new Date(), env: Env = process.env): LocalLicense {
  if (cache && now.getTime() - cache.at < 60_000 && env === process.env) return cache.value;
  const value = compute(now, env);
  if (env === process.env) cache = { at: now.getTime(), value };
  return value;
}

function compute(now: Date, env: Env): LocalLicense {
  if (!isLocalInstall(env)) return { state: "hosted", readOnly: false, maxUnits: null, features: null, message: "" };
  const pub = env.LICENSE_PUBLIC_KEY?.trim() || licensePublicKey();
  if (!pub) return { state: "not_enforced", readOnly: false, maxUnits: null, features: null, message: "" };
  const ci = readCheckInState(env);
  const update = { updateRequired: ci.updateRequired, latestVersion: ci.latestVersion ?? null };
  const text = readLicenseText(env);
  if (!text) {
    const ends = new Date(firstRun(env, now).getTime() + TRIAL_DAYS * 86_400_000);
    const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / 86_400_000);
    return daysLeft > 0
      ? { state: "trial", readOnly: false, maxUnits: null, features: null, daysLeft, message: `Free trial: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Add your DeedWood license in Settings → Billing.`, ...update }
      : { state: "trial_over", readOnly: true, maxUnits: null, features: null, message: "Your free trial has ended, so DeedWood is read-only. Add your license in Settings → Billing to keep working — nothing has been deleted.", ...update };
  }
  const v = verifyLicense(text, pub);
  if (!v.ok) return { state: "invalid", readOnly: true, maxUnits: null, features: null, message: "Your license file isn't valid. Add the license DeedWood sent you in Settings → Billing.", ...update };
  const c = v.claims;
  if (ci.revoked) return { state: "revoked", readOnly: true, maxUnits: c.maxUnits, features: c.features, claims: c, message: ci.message ?? "This license was turned off by DeedWood. Contact support — your data is safe.", ...update };
  const w = licenseWindow(c, now);
  const base = { maxUnits: c.maxUnits, features: c.features, claims: c, daysLeft: w.daysLeft, ...update };
  if (w.state === "valid" || w.state === "not_yet") return { ...base, state: "valid", readOnly: false, message: w.daysLeft <= 30 ? `Your license renews or ends in ${w.daysLeft} days.` : "" };
  if (w.state === "grace") return { ...base, state: "grace", readOnly: false, message: `Your license ended. DeedWood keeps working for ${w.daysLeft} more day${w.daysLeft === 1 ? "" : "s"} — renew to avoid read-only mode.` };
  return { ...base, state: "expired", readOnly: true, message: "Your license has ended, so DeedWood is read-only. Renew it to keep working — nothing has been deleted." };
}

/** Save a license someone pasted or uploaded (after checking it's genuine). */
export function installLicense(text: string, env: Env = process.env): LicenseClaims {
  const pub = env.LICENSE_PUBLIC_KEY?.trim() || licensePublicKey();
  if (!pub) throw new Error("Licensing isn't set up in this version of DeedWood.");
  const v = verifyLicense(text, pub);
  if (!v.ok) throw new Error("That isn't a valid DeedWood license. Copy the whole text DeedWood sent you (it starts with DW1.).");
  mkdirSync(dir(env), { recursive: true });
  writeFileSync(licensePath(env), text.trim());
  // A fresh license clears an old "revoked" answer; the next check-in confirms.
  const ci = readCheckInState(env);
  writeFileSync(statePath(env), JSON.stringify({ ...ci, revoked: false, message: undefined }));
  resetLocalLicenseCache();
  return v.claims;
}

/** Daily: tell DeedWood we're alive, pick up renewals/revocations/update notices. Quietly skips when offline. */
export async function licenseCheckIn(version: string, units: number, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<CheckInState | null> {
  if (!isLocalInstall(env)) return null;
  const url = env.LICENSE_CHECKIN_URL;
  const text = readLicenseText(env);
  if (!url || !text) return null;
  let r: { status: string; token?: string; latestVersion: string | null; minVersion: string | null; updateRequired: boolean; message?: string };
  try {
    const res = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: text, version, units }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    r = await res.json();
  } catch {
    return null; // offline: the license's own dates and grace period apply
  }
  if (r.token && r.status === "active") {
    try { installLicense(r.token, env); } catch { /* ignore a bad reply */ }
  }
  const state: CheckInState = { lastCheckInAt: new Date().toISOString(), revoked: r.status === "revoked", message: r.message, latestVersion: r.latestVersion, minVersion: r.minVersion, updateRequired: r.updateRequired };
  mkdirSync(dir(env), { recursive: true });
  writeFileSync(statePath(env), JSON.stringify(state));
  resetLocalLicenseCache();
  return state;
}

/** Before adding units: a license's unit limit applies to the whole install. */
export async function assertUnitCapacity(countUnits: () => Promise<number>, adding: number) {
  const lic = localLicense();
  if (lic.maxUnits == null || adding <= 0) return;
  const now = await countUnits();
  if (now + adding > lic.maxUnits) {
    const { UserFacingError } = await import("@/server/action-result");
    throw new UserFacingError(`Your license covers ${lic.maxUnits} units and you have ${now}. Upgrade your license to add more.`);
  }
}
