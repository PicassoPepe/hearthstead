import { NextResponse } from "next/server";
import { getContext } from "@/server/context";
import { getOwnerPortalContext } from "@/server/portal/owner-context";
import { streetViewImage } from "@/server/images/place-photos";

/**
 * Google Street View picture of a property, fetched live so the Google key stays on the server
 * and no copy is kept (Google's terms). Staff in the company, or the property's owners.
 */
export async function GET(req: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const staff = await getContext();
  let p: { addressLine1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null } | null = null;
  if (staff) p = await staff.db.property.findFirst({ where: { id: propertyId, ...(staff.membership.propertyScope.length ? { id: { in: staff.membership.propertyScope } } : {}) } });
  else {
    const o = await getOwnerPortalContext();
    if (!o) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (o.propertyIds.includes(propertyId)) p = await o.db.property.findFirst({ where: { id: propertyId } });
  }
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const size = new URL(req.url).searchParams.get("size") === "small" ? "320x240" : "800x600";
  const img = await streetViewImage(p, size);
  if (!img) return NextResponse.json({ error: "No street picture" }, { status: 404 });
  return new NextResponse(Buffer.from(img.bytes), { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
