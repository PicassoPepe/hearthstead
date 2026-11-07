import { NextResponse } from "next/server";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { exportJournal } from "@/server/platform/integrations";

/** Download the general ledger for a period via the AccountingExportProvider (?from&to&format=csv|quickbooks). */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx || !can(ctx.permissions, "accounting", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const from = iso.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : `${today.slice(0, 4)}-01-01`;
  const to = iso.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const r = await exportJournal(ctx.db, from, to, url.searchParams.get("format") ?? undefined);
  return new NextResponse(r.body, { headers: { "content-type": `${r.contentType}; charset=utf-8`, "content-disposition": `attachment; filename="${r.filename}"`, "x-export-summary": JSON.stringify(r.summary) } });
}
