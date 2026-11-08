import { NextResponse } from "next/server";
import { getContext } from "@/server/context";
import { can } from "@/server/permissions";
import { copyBHtml, forms1099, irisCsv } from "@/server/accounting/tax1099";
import { audit } from "@/server/audit";

/** 1099-NEC export: ?year=2025&format=iris (CSV for e-file) | copies (printable recipient copies). */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx || !can(ctx.permissions, "accounting", "view") || ctx.membership.propertyScope.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear() - 1;
  const d = await forms1099(ctx, year);
  await audit(ctx.db, { action: "tax.1099_exported", entityType: "Organization", entityId: ctx.org.id, after: { year, forms: d.forms.length, format: url.searchParams.get("format") ?? "iris" } });
  if (url.searchParams.get("format") === "copies") return new NextResponse(copyBHtml(d), { headers: { "content-type": "text/html; charset=utf-8" } });
  return new NextResponse(irisCsv(d), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="1099-nec-${year}.csv"` } });
}
