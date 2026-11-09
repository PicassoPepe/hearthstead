import { NextResponse } from "next/server";
import { adminDb } from "@/server/db";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** For uptime monitors (e.g. UptimeRobot, free): 200 when the app and database answer, 503 otherwise. */
export async function GET() {
  const started = Date.now();
  try {
    await adminDb.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, version: pkg.version, dbMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, version: pkg.version, error: "database unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
