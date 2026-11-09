#!/usr/bin/env node
/**
 * Create DeedWood's license signing keys (run once, by the platform owner).
 *  - Writes the PUBLIC key into src/lib/license-public-key.ts (commit it; installs use it).
 *  - Prints the PRIVATE key ONCE. Paste it into your host's settings (Railway → Variables) as
 *    LICENSE_SIGNING_PRIVATE_KEY. Never commit it, email it, or put it on a customer's computer.
 * Refuses to replace an existing key unless you pass --force (that would invalidate every license).
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const file = "src/lib/license-public-key.ts";
const src = readFileSync(file, "utf8");
if (!src.includes("EMBEDDED_LICENSE_PUBLIC_KEY: string | null = null") && !process.argv.includes("--force")) {
  console.error("A license key is already set. Replacing it makes every existing license invalid. Use --force only if the private key was lost or leaked.");
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();
writeFileSync(file, src.replace(/export const EMBEDDED_LICENSE_PUBLIC_KEY: string \| null = [^;]+;/, `export const EMBEDDED_LICENSE_PUBLIC_KEY: string | null = ${JSON.stringify(pub)};`));
console.log(`Public key written to ${file} — commit and deploy it.\n`);
console.log("PRIVATE KEY — copy everything between the lines into LICENSE_SIGNING_PRIVATE_KEY in your host's settings:");
console.log("-".repeat(60));
console.log(priv);
console.log("-".repeat(60));
