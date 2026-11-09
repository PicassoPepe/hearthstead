/**
 * DeedWood's license-verification key (public — safe to publish). Replaced by
 * `pnpm license:keygen` the first time licenses are set up. While it's null, computer installs
 * don't enforce licenses. LICENSE_PUBLIC_KEY in the environment overrides it (tests, staging).
 */
export const EMBEDDED_LICENSE_PUBLIC_KEY: string | null = null;

export const licensePublicKey = (): string | null => process.env.LICENSE_PUBLIC_KEY?.trim() || EMBEDDED_LICENSE_PUBLIC_KEY;
