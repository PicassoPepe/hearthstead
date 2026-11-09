import { NextResponse } from "next/server";
import { secretsMatch } from "@/adapters/email/signature";
import { adminDb, appDb } from "@/server/db";
import { runScheduled } from "@/server/jobs/scheduled";

export const dynamic = "force-dynamic";

/**
 * Called by the Worker's scheduled() handler through the self-reference binding.
 * Not for browsers. The header must match AUTH_SECRET.
 */
export async function POST(req: Request) {
  if (!secretsMatch(req.headers.get("x-deedwood-cron"), process.env.AUTH_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const job = new URL(req.url).searchParams.get("job");
  if (job !== "minutely" && job !== "nightly") return NextResponse.json({ ok: false }, { status: 400 });
  const result = await runScheduled(job, { admin: adminDb, app: appDb });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
