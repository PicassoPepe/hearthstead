import { NextResponse } from "next/server";
import { getOwnerPortalContext } from "@/server/portal/owner-context";
import { getStorage } from "@/adapters/storage";

/** Owner file download: only files on the owner's record, their properties, or their requests. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await getOwnerPortalContext();
  if (!o) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const f = await o.db.attachment.findFirst({ where: { id, OR: ownerFileScope(o.owner.id, o.propertyIds) } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getStorage().get(f.storageKey);
  if (!bytes) return NextResponse.json({ error: "Missing" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": f.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" },
  });
}

function ownerFileScope(ownerId: string, propertyIds: string[]) {
  return [{ entityType: "Owner", entityId: ownerId }, { entityType: "Property", entityId: { in: propertyIds } }];
}
