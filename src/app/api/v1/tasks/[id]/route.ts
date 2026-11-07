import { apiRoute, notFound, readJson } from "@/server/api/core";
import * as X from "@/server/api/serialize";
import { UpdateTask } from "@/server/api/schemas";
import { setTaskStatus, updateTask } from "@/server/maintenance/tasks";

export const GET = apiRoute({}, async ({ db }, _req, { id }) => {
  const t = await db.task.findFirst({ where: { id } });
  if (!t) throw notFound("Task");
  return { body: X.task(t) };
});

export const PATCH = apiRoute({ write: true }, async ({ db }, req, { id }) => {
  const v = await readJson(req, UpdateTask);
  if (!(await db.task.findFirst({ where: { id } }))) throw notFound("Task");
  const actor = { userId: null, name: "API", kind: "SYSTEM" as const };
  if (v.priority || v.title) await updateTask(db, id, { ...(v.priority ? { priority: v.priority } : {}), ...(v.title ? { title: v.title } : {}) }, actor);
  if (v.status) await setTaskStatus(db, id, v.status, actor);
  return { body: X.task(await db.task.findFirstOrThrow({ where: { id } })) };
});
