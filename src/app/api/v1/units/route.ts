import { apiRoute, page, pageParams } from "@/server/api/core";
import * as X from "@/server/api/serialize";

export const GET = apiRoute({}, async ({ db }, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const propertyId = url.searchParams.get("property_id");
  const rows = await db.unit.findMany({ where: propertyId ? { propertyId } : {}, take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy });
  const today = new Date();
  const occ = new Set((await db.leaseUnit.findMany({ where: { unitId: { in: rows.map((r) => r.id) }, lease: { status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: today }, OR: [{ moveOutDate: null }, { moveOutDate: { gte: today } }] } }, select: { unitId: true } })).map((x) => x.unitId));
  return { body: page(rows, p.limit, (u) => X.unit(u, occ.has(u.id))) };
});
