import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIn } from "@/server/license/control";
import { clientIp, hit, RateLimited } from "@/server/auth/rate-limit";

const body = z.object({ token: z.string().min(10).max(5_000), version: z.string().max(20), units: z.number().int().min(0).max(1_000_000).optional() });

/** Daily check-in from computer installs (public endpoint; the license itself is the credential). */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req.headers);
    if (ip !== "local") await hit("magicIp", `license:${ip}`);
  } catch (e) {
    if (e instanceof RateLimited) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { token, version, units }" }, { status: 400 });
  return NextResponse.json(await checkIn(parsed.data));
}
