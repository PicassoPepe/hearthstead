import { createHash } from "node:crypto";
import { adminDb } from "@/server/db";

/**
 * Unexpected errors → ErrorEvent table (owner console → System health), an alert email to
 * PLATFORM_ALERT_EMAIL at most once an hour, and Sentry if SENTRY_DSN is set.
 * Never stores request bodies, and never throws.
 */
let lastAlert = 0;
let windowStart = 0;
let windowCount = 0;

export async function recordError(source: "action" | "route" | "render" | "job" | "api", err: unknown, ctx: { path?: string | null; orgId?: string | null; digest?: string | null } = {}) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const message = (e.message || e.name || "Error").slice(0, 500);
    const stack = e.stack?.split("\n").slice(0, 12).join("\n").slice(0, 3000) ?? null;
    const top = e.stack?.split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
    const fingerprint = createHash("sha1").update(`${source}|${message.split("\n")[0]}|${top.trim()}`).digest("hex").slice(0, 16);
    const now = Date.now();
    if (now - windowStart > 3_600_000) { windowStart = now; windowCount = 0; }
    if (++windowCount > 500) return; // an error storm shouldn't fill the database
    await adminDb.errorEvent.create({ data: { source, message, stack, path: ctx.path?.slice(0, 300) ?? null, digest: ctx.digest ?? null, orgId: ctx.orgId ?? null, fingerprint } });
    void sendToSentry(e, source, ctx.path ?? null);
    if (process.env.PLATFORM_ALERT_EMAIL && now - lastAlert > 3_600_000) {
      lastAlert = now;
      const { getEmailProvider } = await import("@/adapters");
      const base = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
      await getEmailProvider().send({
        to: process.env.PLATFORM_ALERT_EMAIL,
        organizationId: null,
        subject: `DeedWood error: ${message.slice(0, 80)}`,
        text: `Something went wrong on ${base || "DeedWood"} (${source}${ctx.path ? ` at ${ctx.path}` : ""}):\n\n${message}\n\nSee all recent errors: ${base}/admin/health\n(You'll get at most one of these emails an hour.)`,
        html: `<p>Something went wrong on ${base || "DeedWood"} (${source}${ctx.path ? ` at <code>${ctx.path.replace(/</g, "&lt;")}</code>` : ""}):</p><pre>${message.replace(/</g, "&lt;")}</pre><p><a href="${base}/admin/health">See all recent errors</a> — you'll get at most one of these emails an hour.</p>`,
      }).catch(() => undefined);
    }
  } catch {
    /* error reporting must never break the app */
  }
}

/** Minimal Sentry "store" call (no SDK needed). */
async function sendToSentry(e: Error, source: string, path: string | null) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\//, "");
    await fetch(`${u.protocol}//${u.host}/api/${project}/store/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=deedwood/1.0` },
      body: JSON.stringify({ platform: "node", level: "error", logger: source, transaction: path ?? undefined, exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: (e.stack ?? "").split("\n").slice(1, 15).reverse().map((l) => ({ function: l.trim() })) } }] } }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* ignore */
  }
}
