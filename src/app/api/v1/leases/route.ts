import { apiRoute, page, pageParams } from "@/server/api/core";
import * as X from "@/server/api/serialize";
import type { LeaseStatus } from "@prisma/client";

const STATUSES = ["DRAFT", "ACTIVE", "EVICTION", "ENDED"];

export const GET = apiRoute({}, async ({ db }, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const rows = await db.lease.findMany({ where: status && STATUSES.includes(status) ? { status: status as LeaseStatus } : {}, take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy, include: { units: true, tenants: true, recurring: { where: { deletedAt: null } } } });
  return { body: page(rows, p.limit, X.lease) };
});
