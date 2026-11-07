import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/api/openapi";

export function GET(req: Request) {
  return NextResponse.json(openApiDocument(process.env.AUTH_URL ?? new URL(req.url).origin), { headers: { "cache-control": "public, max-age=300" } });
}
