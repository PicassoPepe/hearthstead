import { apiRoute, page, pageParams, readJson } from "@/server/api/core";
import * as X from "@/server/api/serialize";
import { CreateTask } from "@/server/api/schemas";
import { createTask } from "@/server/maintenance/tasks";
import type { TaskStatus } from "@prisma/client";

export const GET = apiRoute({}, async ({ db }, req) => {
  const url = new URL(req.url);
  const p = pageParams(url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const rows = await db.task.findMany({ where: { ...(status ? { status: status as TaskStatus } : {}), type: { not: "INSPECTION" } }, take: p.take, cursor: p.cursor, skip: p.skip, orderBy: p.orderBy });
  return { body: page(rows, p.limit, X.task) };
});

export const POST = apiRoute({ write: true }, async ({ db }, req) => {
  const v = await readJson(req, CreateTask);
  const t = await createTask(db, { type: v.type, title: v.title, description: v.description, priority: v.priority, category: v.category, propertyId: v.property_id, unitId: v.unit_id, dueDate: v.due_date }, { userId: null, name: "API", kind: "SYSTEM" });
  return { status: 201, body: X.task((await db.task.findFirstOrThrow({ where: { id: t.id } }))) };
});
