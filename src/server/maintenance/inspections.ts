import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getLlmProvider } from "@/adapters/llm";
import { addActivity, type TaskActor } from "./tasks";

const CONDITIONS = ["GOOD", "FAIR", "POOR", "DAMAGED", "NA"];

export async function saveInspectionItem(db: ScopedDb, itemId: string, patch: { condition?: string | null; note?: string | null }) {
  const item = await db.inspectionItem.findFirst({ where: { id: itemId } });
  if (!item) throw new UserFacingError("Item not found");
  if (patch.condition && !CONDITIONS.includes(patch.condition)) throw new UserFacingError("Invalid condition");
  await db.inspectionItem.update({
    where: { id: itemId },
    data: { condition: patch.condition ?? item.condition, note: patch.note !== undefined ? patch.note || null : item.note },
  });
}

/** AI summary of an inspection (LlmProvider; the mock summarizes deterministically). Audit-logged. */
export async function summarizeInspection(db: ScopedDb, taskId: string, actor: TaskActor): Promise<string> {
  const t = await db.task.findFirst({ where: { id: taskId, type: "INSPECTION" }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!t) throw new UserFacingError("Inspection not found");
  const rated = t.items.filter((i) => i.condition);
  if (!rated.length) throw new UserFacingError("Rate at least one item first");
  const llm = getLlmProvider();
  const input = rated.map((i) => `- ${i.room} › ${i.item}: ${i.condition}${i.note ? ` (${i.note})` : ""}`).join("\n");
  const summary = await llm.complete({
    purpose: "inspection-summary",
    system:
      "You summarize rental unit inspections for a property manager. Be concise (3-5 sentences). Call out damaged and poor items, suggest next steps, and never invent items that aren't listed.",
    messages: [{ role: "user", content: `${t.inspectionKind ?? "PERIODIC"} inspection results:\n${input}` }],
    maxTokens: 400,
  });
  await db.task.update({ where: { id: taskId }, data: { aiSummary: summary } });
  await addActivity(db, taskId, actor, "COMMENT", "AI summary generated");
  await audit(db, { action: "ai.inspection_summary", entityType: "Task", entityId: taskId, actorType: "AI", after: { model: `${llm.name}:${llm.model}` } });
  return summary;
}
