import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/context";
import { globalSearch } from "@/server/search";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await globalSearch(ctx, q);
  return NextResponse.json({ results });
}
