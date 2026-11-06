import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/context";
import { getAddressProvider } from "@/adapters/address";

export async function GET(req: NextRequest) {
  if (!(await getContext())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  return NextResponse.json({ suggestions: await getAddressProvider().suggest(q) });
}
