import { NextResponse } from "next/server";
import { API_OPERATIONS } from "@/server/api/openapi";

export function GET() {
  return NextResponse.json({ object: "api", version: "1", docs: "/api/v1/openapi.json", endpoints: API_OPERATIONS });
}
