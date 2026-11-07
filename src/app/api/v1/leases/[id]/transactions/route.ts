import { apiRoute, notFound, page, pageParams } from "@/server/api/core";
import * as X from "@/server/api/serialize";

export const GET = apiRoute({}, async ({ db }, req, { id }) => {
  if (!(await db.lease.findFirst({ where: { id } }))) throw notFound("Lease");
  const p = pageParams(new URL(req.url));
  const rows = await db.leaseTransaction.findMany({ where: { leaseId: id }, take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy });
  return { body: page(rows, p.limit, X.transaction) };
});
