import { createHash, randomBytes } from "node:crypto";

/**
 * ESignProvider adapter. `builtin` (default) hosts signing in-app: each signer gets a one-time
 * link (only its SHA-256 is stored), the document is frozen and hashed at send time, and every
 * view/sign/decline is recorded with IP and user agent for the audit trail. A DocuSign or
 * Dropbox Sign implementation would create envelopes instead of tokens.
 */
export interface ESignProvider {
  readonly name: string;
  /** Returns the raw token for a signer's link and the hash to store. */
  issueToken(): { token: string; hash: string };
  hashToken(token: string): string;
  hashDocument(html: string): string;
}

class BuiltinESignProvider implements ESignProvider {
  readonly name = "builtin";
  issueToken() {
    const token = randomBytes(24).toString("base64url");
    return { token, hash: this.hashToken(token) };
  }
  hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  hashDocument(html: string) {
    return createHash("sha256").update(html).digest("hex");
  }
}

let p: ESignProvider | undefined;
export function getESignProvider(): ESignProvider {
  p ??= new BuiltinESignProvider();
  return p;
}
