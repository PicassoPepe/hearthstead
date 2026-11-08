import { NextResponse } from "next/server";
import { adminDb } from "@/server/db";
import { getStorage } from "@/adapters/storage";

/** Public images only (logos, property/unit photos, avatars). Everything else goes through /api/files. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await adminDb.attachment.findFirst({ where: { id, public: true, deletedAt: null } });
  if (!f || !f.contentType.startsWith("image/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getStorage().get(f.storageKey);
  if (!bytes) return NextResponse.json({ error: "Missing" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": f.contentType, "Cache-Control": "public, max-age=86400, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
