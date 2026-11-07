import { apiRoute, page, pageParams } from "@/server/api/core";
import * as X from "@/server/api/serialize";

export const GET = apiRoute({}, async ({ db }, req) => {
  const p = pageParams(new URL(req.url));
  const rows = await db.property.findMany({ take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy, include: { _count: { select: { units: { where: { deletedAt: null } } } } } });
  return { body: page(rows, p.limit, X.property) };
});
