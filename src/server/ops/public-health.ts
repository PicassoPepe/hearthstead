import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { adminDb } from "@/server/db";
import { workersAiBinding } from "@/server/runtime";

export type Probe = "ok" | "down" | "off";
export type PublicHealth = {
  ok: boolean;
  db: "ok" | "down";
  storage: "ok" | "down";
  ai: Probe;
  email: "ok" | "off";
  payments: "off" | "on";
  version: string;
};

/** Shape returned by GET /api/health. No connection strings, tokens, or key fragments. */
export function assembleHealth(parts: { db: boolean; storage: boolean; ai: Probe; email: "ok" | "off"; paymentsOn: boolean; version: string }): PublicHealth {
  const db = parts.db ? "ok" : "down";
  const storage = parts.storage ? "ok" : "down";
  return {
    ok: db === "ok" && storage === "ok",
    db,
    storage,
    ai: parts.ai,
    email: parts.email,
    payments: parts.paymentsOn ? "on" : "off",
    version: parts.version,
  };
}

export function aiProbe(env: Record<string, string | undefined> = process.env): Probe {
  const name = (env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  if (!name || name === "mock") return "off";
  if (name === "cloudflare") {
    if (workersAiBinding()) return "ok";
    if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN) return "ok";
    if ((env.LLM_FALLBACK ?? "").includes("groq") && env.GROQ_API_KEY) return "ok";
    return "down";
  }
  if (name === "groq") return env.GROQ_API_KEY ? "ok" : "down";
  if (name === "openrouter") return env.OPENROUTER_API_KEY ? "ok" : "down";
  if (name === "anthropic") return env.ANTHROPIC_API_KEY ? "ok" : "down";
  if (name === "ollama") return "ok";
  return "off";
}

export function emailProbe(env: Record<string, string | undefined> = process.env): "ok" | "off" {
  const kind = (env.EMAIL_PROVIDER ?? "mock").trim().toLowerCase();
  if (kind === "resend") return env.RESEND_API_KEY && env.EMAIL_FROM ? "ok" : "off";
  if (kind === "smtp") return env.SMTP_URL ? "ok" : "off";
  return "off";
}

async function storageOk(): Promise<boolean> {
  if (process.env.STORAGE_PROVIDER === "s3") {
    if (!process.env.S3_ACCESS_KEY || !process.env.S3_BUCKET) return false;
    const client = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? "" },
    });
    await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, MaxKeys: 1 }));
    return true;
  }
  const { access, mkdir } = await import("node:fs/promises");
  const dir = process.env.STORAGE_LOCAL_DIR ?? "storage";
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  return true;
}

export async function publicHealth(version: string): Promise<PublicHealth> {
  let db = false;
  try {
    await adminDb.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  let storage = false;
  try {
    storage = await storageOk();
  } catch {
    storage = false;
  }
  return assembleHealth({
    db,
    storage,
    ai: aiProbe(),
    email: emailProbe(),
    paymentsOn: process.env.PAYMENTS_ENABLED === "1",
    version,
  });
}
