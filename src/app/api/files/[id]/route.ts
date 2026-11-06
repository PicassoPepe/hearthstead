import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { ENTITY_MODULE, isEntityType } from "@/server/records/service";
import { getStorage } from "@/adapters/storage";

/** Authenticated, tenant-scoped file download. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const file = await ctx.db.attachment.findFirst({ where: { id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = file.entityType && isEntityType(file.entityType) ? ENTITY_MODULE[file.entityType] : "files";
  if (!can(ctx.permissions, guard, "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const bytes = await getStorage().get(file.storageKey);
  if (!bytes) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });
  const inline = file.contentType.startsWith("image/") || file.contentType === "application/pdf";
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline && !download ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
