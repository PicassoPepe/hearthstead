import "server-only";
import type { AppContext } from "@/server/context";
import { adminDb } from "@/server/db";
import { formatBytes } from "./service";
import type { NoteView } from "@/components/records/notes-panel";
import type { FileView } from "@/components/records/files-panel";

/** Author names come from global User rows (not tenant data), resolved in one query. */
async function authorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const users = await adminDb.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

export async function notesFor(ctx: AppContext, entityType: string, entityId: string): Promise<NoteView[]> {
  const notes = await ctx.db.note.findMany({ where: { entityType, entityId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] });
  const names = await authorNames(notes.map((n) => n.createdById));
  return notes.map((n) => ({ id: n.id, body: n.body, author: names.get(n.createdById ?? "") ?? "System", createdAt: n.createdAt.toISOString(), mine: n.createdById === ctx.user.id }));
}

export async function filesFor(ctx: AppContext, entityType?: string, entityId?: string): Promise<FileView[]> {
  const files = await ctx.db.attachment.findMany({
    where: entityType ? { entityType, entityId } : {},
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const names = await authorNames(files.map((f) => f.createdById));
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    contentType: f.contentType,
    size: formatBytes(f.sizeBytes),
    uploadedAt: f.createdAt.toISOString(),
    author: names.get(f.createdById ?? "") ?? "System",
    linkedTo: !entityType && f.entityType && f.entityId ? { label: f.entityType, href: entityHref(f.entityType, f.entityId) } : null,
  }));
}

export function entityHref(type: string, id: string): string {
  switch (type) {
    case "Property": return `/app/rentals/${id}`;
    case "Unit": return `/app/rentals/units/${id}`;
    case "Owner": return `/app/people/owners/${id}`;
    case "Portfolio": return `/app/rentals/portfolios`;
    case "Lease": return `/app/leasing/${id}`;
    case "Tenant": return `/app/people/tenants/${id}`;
    default: return "/app/files";
  }
}
