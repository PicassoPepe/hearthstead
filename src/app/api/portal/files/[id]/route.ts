import { NextResponse } from "next/server";
import { getPortalContext } from "@/server/portal/context";
import { getStorage } from "@/adapters/storage";

/** Tenant file download: only files on the tenant's own leases or their own maintenance requests. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const myTasks = (await ctx.db.task.findMany({ where: { tenantId: ctx.tenant.id, type: "TENANT_REQUEST" }, select: { id: true } })).map((t) => t.id);
  const f = await ctx.db.attachment.findFirst({
    where: { id, OR: [{ entityType: "Lease", entityId: { in: ctx.leases.map((l) => l.id) } }, { entityType: "Task", entityId: { in: myTasks } }] },
  });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getStorage().get(f.storageKey);
  if (!bytes) return NextResponse.json({ error: "Missing" }, { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": f.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" },
  });
}
