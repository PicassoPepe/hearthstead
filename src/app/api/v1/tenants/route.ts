import { apiRoute, page, pageParams, readJson } from "@/server/api/core";
import * as X from "@/server/api/serialize";
import { CreateTenant } from "@/server/api/schemas";
import { audit } from "@/server/audit";

export const GET = apiRoute({}, async ({ db }, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const email = url.searchParams.get("email");
  const rows = await db.tenant.findMany({ where: email ? { email: email.toLowerCase() } : {}, take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy });
  return { body: page(rows, p.limit, X.tenant) };
});

export const POST = apiRoute({ write: true }, async ({ db, orgId }, req) => {
  const v = await readJson(req, CreateTenant);
  const t = await db.tenant.create({ data: { organizationId: orgId, firstName: v.first_name, lastName: v.last_name, email: v.email?.toLowerCase() ?? null, phone: v.phone ?? null } });
  await audit(db, { action: "tenant.created", entityType: "Tenant", entityId: t.id, actorType: "API", after: v });
  return { status: 201, body: X.tenant(t) };
});
