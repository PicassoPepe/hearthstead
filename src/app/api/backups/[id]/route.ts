import { NextResponse } from "next/server";
import { adminDb } from "@/server/db";
import { readBackup } from "@/server/ops/backup-job";
import { mayManageBackups } from "@/server/ops/backup-access";

/** Download a backup file (owner console, or Settings → Backups on a computer install). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await mayManageBackups())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { run, bytes } = await readBackup(adminDb, (await params).id);
    return new NextResponse(bytes, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${run.key!.split("/").pop()}"`, "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
