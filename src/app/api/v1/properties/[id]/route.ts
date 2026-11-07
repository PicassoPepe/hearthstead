import { apiRoute, notFound } from "@/server/api/core";
import * as X from "@/server/api/serialize";

export const GET = apiRoute({}, async ({ db }, _req, { id }) => {
  const p = await db.property.findFirst({ where: { id }, include: { _count: { select: { units: { where: { deletedAt: null } } } } } });
  if (!p) throw notFound("Property");
  return { body: X.property(p) };
});
