import { NextResponse } from "next/server";
import { publicHealth } from "@/server/ops/public-health";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/** For uptime monitors. 200 when the database and file storage answer, 503 otherwise. No secrets. */
export async function GET() {
  const version = process.env.DEEDWOOD_GIT_SHA || pkg.version;
  const body = await publicHealth(version);
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
