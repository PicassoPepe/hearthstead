"use server";

import { revalidatePath } from "next/cache";
import { getContext, requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { ENTITY_MODULE, isEntityType, addNote, setNoteDeleted, setAttachmentDeleted, storeAttachment } from "@/server/records/service";

function moduleFor(entityType: string) {
  if (!isEntityType(entityType)) throw new UserFacingError("Unsupported record type");
  return ENTITY_MODULE[entityType];
}

export async function createNote(entityType: string, entityId: string, body: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission(moduleFor(entityType), "edit");
    const r = await addNote(ctx.db, entityType as never, entityId, body);
    revalidatePath("/app", "layout");
    return r;
  }, "Note added");
}

export async function deleteNote(id: string, deleted = true): Promise<ActionResult> {
  return runAction(async () => {
    const base = await getContext();
    if (!base) throw new UserFacingError("Not signed in");
    const note = await base.db.note.findFirst({ where: { id, deletedAt: undefined } });
    if (!note) throw new UserFacingError("Note not found");
    const ctx = await requirePermission(moduleFor(note.entityType), "edit");
    await setNoteDeleted(ctx.db, id, deleted);
    revalidatePath("/app", "layout");
  }, deleted ? "Note deleted" : "Note restored");
}

/** Upload one or more files (FormData: files[], entityType?, entityId?). */
export async function uploadFiles(form: FormData): Promise<ActionResult<{ ids: string[] }>> {
  return runAction(async () => {
    const entityType = String(form.get("entityType") ?? "");
    const entityId = String(form.get("entityId") ?? "");
    const link = entityType && entityId ? { type: entityType, id: entityId } : null;
    const ctx = await requirePermission(link ? moduleFor(link.type) : "files", "edit");
    const files = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
    if (files.length === 0) throw new UserFacingError("Choose at least one file");
    if (files.length > 20) throw new UserFacingError("Upload up to 20 files at a time");
    const ids: string[] = [];
    for (const f of files) {
      const r = await storeAttachment(ctx.db, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }, link as never);
      ids.push(r.id);
    }
    revalidatePath("/app", "layout");
    return { ids };
  }, "Upload complete");
}

export async function deleteFile(id: string, deleted = true): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("files", "edit");
    await setAttachmentDeleted(ctx.db, id, deleted);
    revalidatePath("/app", "layout");
  }, deleted ? "File deleted" : "File restored");
}
