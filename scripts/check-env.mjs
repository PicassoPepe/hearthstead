#!/usr/bin/env node
/**
 * Checks a hosted DeedWood's settings before it starts (scripts/serve.mjs runs this; you can run
 * `pnpm check-env` too). Fails on anything missing or still a placeholder, so a server never goes
 * live with a demo secret. Real values belong ONLY in the host's settings (Railway, Render, Fly…),
 * never in git: AUTH_SECRET, DATABASE_*, STRIPE_*, TWILIO_*, S3_*, ANTHROPIC_API_KEY, REGRID_TOKEN,
 * GOOGLE_MAPS_API_KEY.
 */
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = /^(|changeme|change-me|todo|xxx+|your[-_ ].*|dev-only.*|test|secret|password)$/i;

/** Returns { errors, warnings } for an environment (exported for tests). */
export function checkEnv(env) {
  const errors = [];
  const warnings = [];
  const bad = (v) => v === undefined || PLACEHOLDER.test(String(v).trim()) || /dev-only|placeholder|example/i.test(String(v));

  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32 || bad(secret)) errors.push("AUTH_SECRET must be a long random string (32+ characters), not a placeholder.");
  if (!env.DATABASE_ADMIN_URL && !env.DATABASE_URL) errors.push("Set DATABASE_ADMIN_URL (or DATABASE_URL) to your Postgres connection string.");
  for (const k of ["DATABASE_ADMIN_URL", "DATABASE_URL"]) {
    const v = env[k];
    if (v && /localhost|127\.0\.0\.1/.test(v) && env.DEEDWOOD_ALLOW_LOCAL_DB !== "1") warnings.push(`${k} points at this machine (localhost). That's fine for testing; hosted servers normally use the host's database.`);
    if (v && /:(postgres|password|deedwood_app)@/.test(v)) warnings.push(`${k} uses a default password. Use the one your host generated.`);
  }
  if (!env.AUTH_URL) errors.push("Set AUTH_URL to your public address, e.g. https://your-app.up.railway.app");
  else if (!env.AUTH_URL.startsWith("https://")) errors.push("AUTH_URL must start with https:// on a hosted server (sign-in cookies are only sent over https).");

  // Payments stay in test mode until the owner approves going live.
  const stripe = env.STRIPE_SECRET_KEY;
  if (stripe && bad(stripe)) errors.push("STRIPE_SECRET_KEY looks like a placeholder.");
  if (stripe?.startsWith("sk_live_") && env.STRIPE_LIVE_APPROVED !== "1") errors.push("STRIPE_SECRET_KEY is a live key. Use a test key (sk_test_…) until going live is approved, then set STRIPE_LIVE_APPROVED=1.");
  for (const k of ["TWILIO_AUTH_TOKEN", "S3_SECRET_ACCESS_KEY", "ANTHROPIC_API_KEY", "REGRID_TOKEN", "GOOGLE_MAPS_API_KEY", "SMTP_PASS"]) {
    if (env[k] !== undefined && bad(env[k])) errors.push(`${k} is set but looks like a placeholder — remove it or paste the real value in your host's settings.`);
  }
  // Real money only through the real processor: never let the test processor mark payments paid.
  if (env.PAYMENTS_ENABLED === "1") {
    if (env.PAYMENTS_PROVIDER !== "stripe") errors.push("PAYMENTS_ENABLED=1 needs PAYMENTS_PROVIDER=stripe. With the test processor, payments would be marked paid without any money moving.");
    if (!stripe || bad(stripe)) errors.push("PAYMENTS_ENABLED=1 needs STRIPE_SECRET_KEY.");
    const pk = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!pk || !/^pk_(test|live)_/.test(pk)) errors.push("PAYMENTS_ENABLED=1 needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_… or pk_live_…) for the secure card and bank forms.");
    else if (stripe && pk.startsWith("pk_live_") !== stripe.startsWith("sk_live_")) errors.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY must both be test keys or both live keys.");
  }
  if (env.ENABLE_DEV_TOOLS === "1") warnings.push("ENABLE_DEV_TOOLS=1 turns on the test inbox and webhook sink. Turn it off for real customers.");
  return { errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (existsSync(".env")) loadEnvFile(".env");
  const { errors, warnings } = checkEnv(process.env);
  for (const w of warnings) console.warn(`[deedwood] warning: ${w}`);
  for (const e of errors) console.error(`[deedwood] ${e}`);
  if (errors.length) process.exit(1);
  console.log("[deedwood] settings look good.");
}
