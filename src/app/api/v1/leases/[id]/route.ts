import { apiRoute, notFound } from "@/server/api/core";
import * as X from "@/server/api/serialize";

export const GET = apiRoute({}, async ({ db }, _req, { id }) => {
  const l = await db.lease.findFirst({ where: { id }, include: { units: true, tenants: true, recurring: { where: { deletedAt: null } } } });
  if (!l) throw notFound("Lease");
  return { body: X.lease(l) };
});
