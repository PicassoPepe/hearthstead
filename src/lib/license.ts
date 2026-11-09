import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/**
 * DeedWood licenses for computer (self-hosted) installs.
 *
 * Format: `DW1.<base64url canonical JSON claims>.<base64url Ed25519 signature>`.
 * DeedWood's server signs with a private key that never leaves it (LICENSE_SIGNING_PRIVATE_KEY);
 * every install verifies offline with the public key (src/lib/license-public-key.ts).
 */
export type LicenseClaims = {
  licenseId: string;
  customer: string;
  mode: "SELF_HOSTED";
  planKey: string;
  maxUnits: number;
  features: string[];
  validFrom: string;
  validUntil: string;
  graceDays: number;
  releaseChannel: string;
  issuedAt: string;
};

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** JSON with keys sorted at every level, so the signed bytes are always identical. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function generateLicenseKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** PEM, or the PEM with "\n" written as literal \n (how host settings often store it). */
const pem = (k: string) => k.replace(/\\n/g, "\n").trim();

export function signLicense(claims: LicenseClaims, privateKeyPem: string): string {
  const body = Buffer.from(canonical(claims));
  const sig = sign(null, body, createPrivateKey(pem(privateKeyPem)));
  return `DW1.${b64u(body)}.${b64u(sig)}`;
}

export type Verified = { ok: true; claims: LicenseClaims } | { ok: false; reason: "format" | "signature" | "claims" };

export function verifyLicense(token: string, publicKeyPem: string): Verified {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "DW1") return { ok: false, reason: "format" };
  let body: Buffer, sig: Buffer;
  try {
    body = Buffer.from(parts[1]!, "base64url");
    sig = Buffer.from(parts[2]!, "base64url");
  } catch {
    return { ok: false, reason: "format" };
  }
  let good = false;
  try {
    good = verify(null, body, createPublicKey(pem(publicKeyPem)), sig);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "signature" };
  try {
    const c = JSON.parse(body.toString("utf8")) as LicenseClaims;
    if (c.mode !== "SELF_HOSTED" || !c.licenseId || !Number.isFinite(c.maxUnits) || Number.isNaN(Date.parse(c.validUntil))) return { ok: false, reason: "claims" };
    return { ok: true, claims: c };
  } catch {
    return { ok: false, reason: "claims" };
  }
}

/** valid → grace (past validUntil, within graceDays) → expired. */
export function licenseWindow(c: Pick<LicenseClaims, "validFrom" | "validUntil" | "graceDays">, now = new Date()) {
  const until = new Date(c.validUntil);
  const graceEnds = new Date(until.getTime() + c.graceDays * 86_400_000);
  const state = now < new Date(c.validFrom) ? ("not_yet" as const) : now <= until ? ("valid" as const) : now <= graceEnds ? ("grace" as const) : ("expired" as const);
  return { state, validUntil: until, graceEnds, daysLeft: Math.ceil(((state === "grace" ? graceEnds : until).getTime() - now.getTime()) / 86_400_000) };
}
