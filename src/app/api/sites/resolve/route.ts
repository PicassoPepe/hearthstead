import { NextResponse } from "next/server";
import { slugForDomain } from "@/server/site/service";

/** Which company's website lives on this domain? (Used by the middleware for custom domains.) */
export async function GET(req: Request) {
  const host = new URL(req.url).searchParams.get("host")?.toLowerCase().slice(0, 253) ?? "";
  if (!/^[a-z0-9.-]+$/.test(host)) return NextResponse.json({ slug: null });
  return NextResponse.json({ slug: await slugForDomain(host) }, { headers: { "cache-control": "no-store" } });
}
