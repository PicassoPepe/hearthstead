import { randomUUID } from "node:crypto";
import type { ScopedDb } from "@/server/dal";
import type { Module } from "@/server/permissions";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getStorage } from "@/adapters/storage";

/**
 * Polymorphic notes & files attached to any entity. Each entity type maps to the permission
 * module that guards it, and every attach call verifies the entity exists in this org.
 */
export const ENTITY_MODULE = {
  Property: "rentals",
  Unit: "rentals",
  Portfolio: "rentals",
  Owner: "people",
  Lease: "leasing",
  Tenant: "people",
} as const satisfies Record<string, Module>;
export type EntityType = keyof typeof ENTITY_MODULE;

export function isEntityType(t: string): t is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_MODULE, t);
}

export async function assertEntity(db: ScopedDb, type: EntityType, id: string): Promise<void> {
  const found =
    type === "Property" ? await db.property.findFirst({ where: { id }, select: { id: true } })
    : type === "Unit" ? await db.unit.findFirst({ where: { id }, select: { id: true } })
    : type === "Portfolio" ? await db.portfolio.findFirst({ where: { id }, select: { id: true } })
    : type === "Lease" ? await db.lease.findFirst({ where: { id }, select: { id: true } })
    : type === "Tenant" ? await db.tenant.findFirst({ where: { id }, select: { id: true } })
    : await db.owner.findFirst({ where: { id }, select: { id: true } });
  if (!found) throw new UserFacingError(`${type} not found`);
}

// ─── Notes ────────────────────────────────────────────────────────────────

export async function addNote(db: ScopedDb, type: EntityType, entityId: string, body: string): Promise<{ id: string }> {
  const text = body.trim();
  if (!text) throw new UserFacingError("Write something first", { body: "Write something first" });
  if (text.length > 10_000) throw new UserFacingError("Notes are limited to 10,000 characters", { body: "Too long" });
  await assertEntity(db, type, entityId);
  const n = await db.note.create({ data: { organizationId: db.ctx.orgId, entityType: type, entityId, body: text, createdById: db.ctx.userId } });
  await audit(db, { action: "note.created", entityType: type, entityId });
  return { id: n.id };
}

export async function setNoteDeleted(db: ScopedDb, id: string, deleted: boolean): Promise<void> {
  const res = await db.note.updateMany({ where: { id, deletedAt: deleted ? null : { not: null } }, data: { deletedAt: deleted ? new Date() : null } });
  if (res.count === 0) throw new UserFacingError("Note not found");
}

// ─── Files ────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf",
  "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (cleaned || "file").slice(0, 180);
}

export async function storeAttachment(
  db: ScopedDb,
  file: { name: string; type: string; bytes: Uint8Array },
  link: { type: EntityType; id: string } | null,
  category?: string,
): Promise<{ id: string }> {
  if (file.bytes.byteLength === 0) throw new UserFacingError(`${file.name} is empty`);
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new UserFacingError(`${file.name} is larger than 10 MB`);
  const type = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type)) throw new UserFacingError(`${file.name}: this file type isn't supported`);
  if (link) await assertEntity(db, link.type, link.id);

  const key = `${db.ctx.orgId}/${randomUUID()}`;
  await getStorage().put(key, file.bytes, type);
  const a = await db.attachment.create({
    data: {
      organizationId: db.ctx.orgId,
      entityType: link?.type ?? null,
      entityId: link?.id ?? null,
      name: safeFileName(file.name),
      contentType: type,
      sizeBytes: file.bytes.byteLength,
      storageKey: key,
      category: category ?? (type.startsWith("image/") ? "Photo" : "Document"),
      createdById: db.ctx.userId,
    },
  });
  await audit(db, { action: "file.uploaded", entityType: link?.type ?? "Attachment", entityId: link?.id ?? a.id, after: { name: a.name, sizeBytes: a.sizeBytes } });
  return { id: a.id };
}

export async function setAttachmentDeleted(db: ScopedDb, id: string, deleted: boolean): Promise<void> {
  const res = await db.attachment.updateMany({ where: { id, deletedAt: deleted ? null : { not: null } }, data: { deletedAt: deleted ? new Date() : null } });
  if (res.count === 0) throw new UserFacingError("File not found");
  await audit(db, { action: deleted ? "file.deleted" : "file.restored", entityType: "Attachment", entityId: id });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / (1024 * 102.4)) / 10} MB`;
}
